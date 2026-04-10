# IPTables in Datalog

This document describes how raw `iptables-save` configuration files map to the flat Datalog fact schema used by the Datalog engine, and what the Datalog layer adds on top.

## Rule-by-rule mapping

Each line in an `iptables-save` config maps to a single Datalog fact.

### Firewall rules

An iptables rule:

```
-A INPUT -p tcp -s 192.168.1.0/24 --dport 22 -j ACCEPT
```

becomes:

```datalog
rule(machine_a, "input", 7, "accept", "192.168.1.0/24", "tcp", 22).
```

The predicate is `rule(Machine, Chain, Index, Action, Source, Protocol, DPort)`:

| Position | Field    | iptables flag   | Example value         |
|----------|----------|-----------------|-----------------------|
| 1        | Machine  | *(which host)*  | `machine_a`           |
| 2        | Chain    | `-A INPUT`      | `"input"`             |
| 3        | Index    | *(line order)*  | `7`                   |
| 4        | Action   | `-j ACCEPT`     | `"accept"`            |
| 5        | Source   | `-s 192.168.1.0/24` | `"192.168.1.0/24"` |
| 6        | Protocol | `-p tcp`        | `"tcp"`               |
| 7        | DPort    | `--dport 22`    | `22`                  |

### Chain default policies

The header section of `iptables-save`:

```
*filter
:INPUT DROP [0:0]
:FORWARD DROP [0:0]
:OUTPUT ACCEPT [0:0]
```

maps to `chain(Machine, Chain, DefaultPolicy)` facts:

```datalog
chain(machine_a, "input", "drop").
chain(machine_a, "forward", "drop").
chain(machine_a, "output", "accept").
```

## Absent flags

When an iptables flag is not present, the Datalog fact uses a conventional default:

| Missing flag | Meaning       | Datalog value   |
|-------------|---------------|-----------------|
| No `-s`     | Any source    | `"0.0.0.0/0"`  |
| No `-p`     | Any protocol  | `"any"`         |
| No `--dport`| Any port      | `"any"`         |

For example, `-A INPUT -s 10.0.0.0/8 -j DROP` (no protocol or port) becomes:

```datalog
rule(machine_a, "input", 10, "drop", "10.0.0.0/8", "any", "any").
```

## Ordering

IPTables is **first-match-wins**: rules are evaluated top-to-bottom and the first matching rule determines the action. The Datalog schema encodes order explicitly as the **index** field (argument 3). This lets Datalog rules reason about ordering without being order-dependent themselves:

```datalog
% "Earlier comes before Idx in the chain"
redundant(M, Idx) :-
    rule(M, Chain, Idx, Action, Src, Proto, Port),
    rule(M, Chain, Earlier, Action, Broader, Proto, Port),
    lt(Earlier, Idx),
    ip_in(Src, Broader).
```

The `lt(Earlier, Idx)` comparison captures "this rule comes before that rule." When converting back to iptables, sort by index to recover the original ordering.

## What Datalog adds

The raw iptables config is a flat list of rules with no way to express cross-cutting analysis. The Datalog layer adds:

### CIDR containment via `ip_in`

The `ip_in(Addr, Cidr)` built-in checks whether one IP range is contained within another. This enables reasoning that iptables itself cannot perform:

- `ip_in("10.0.0.1", "10.0.0.0/8")` -- true (point in range)
- `ip_in("10.0.0.0/24", "10.0.0.0/8")` -- true (narrow range inside broad range)
- `ip_in("192.168.1.0/24", "10.0.0.0/8")` -- false

A bare IP with no `/` prefix is treated as `/32`.

### Redundancy detection

A rule is redundant if an earlier rule in the same chain with the same action, destination, protocol, and port covers a broader source range:

```datalog
redundant(M, Idx) :-
    rule(M, Chain, Idx, Action, Src, Proto, Port),
    rule(M, Chain, Earlier, Action, Broader, Proto, Port),
    lt(Earlier, Idx),
    ip_in(Src, Broader).
```

Example: `DROP 10.0.0.1` after `DROP 10.0.0.0/8` is redundant because the `/8` already covers it.

### Unreachability detection

A rule is unreachable if an earlier DROP rule covers its source range, making the later ACCEPT dead code:

```datalog
unreachable(M, Idx) :-
    rule(M, Chain, Idx, "accept", Src, _, _),
    rule(M, Chain, Earlier, "drop", DropSrc, _, _),
    lt(Earlier, Idx),
    ip_in(Src, DropSrc).
```

Example: `ACCEPT 10.0.0.5 tcp 80` after `DROP 10.0.0.0/8` will never fire.

### Cross-machine constraints

Datalog constraints can span multiple machines, enforcing network-wide policies:

```datalog
% Blocked IPs must not slip through any machine's rules
:- blocked_ip(IP), rule(M, "input", _, "accept", Src, _, _), ip_in(IP, Src).

% Database servers must not expose DB ports to the world
:- role(M, database), rule(M, "input", _, "accept", "0.0.0.0/0", _, 5432).
```

### Derived relations

Higher-level concepts are derived from the base facts:

```datalog
allows(M, Src, Port) :- rule(M, "input", _, "accept", Src, _, Port).
blocks(M, Src) :- rule(M, "input", _, "drop", Src, _, _).
```

## What gets simplified

The flat schema focuses on the source-CIDR / protocol / port triple, which is where `ip_in` reasoning is most valuable. Some iptables features are approximated or omitted:

| iptables feature | Handling |
|-----------------|----------|
| `-i lo` (interface match) | Modeled as source `"127.0.0.0/8"` |
| `-m state --state ESTABLISHED,RELATED` | Omitted (stateful tracking) |
| `-m limit --limit 1/s` | Omitted (rate limiting) |
| `--icmp-type echo-request` | Omitted (ICMP type matching) |
| `-m multiport --dports 80,443` | Separate rules per port |

These could be added as additional predicate columns if a use case requires them.

## Reversibility

The Datalog representation can be converted back to `iptables-save` format:

1. Query all `chain(M, ...)` facts for the target machine to emit the header
2. Query all `rule(M, ...)` facts, sort by index
3. Map each fact back to an iptables line:
   - `"0.0.0.0/0"` source -> omit `-s`
   - `"any"` protocol -> omit `-p`
   - `"any"` dport -> omit `--dport`
   - Uppercase the action (`"accept"` -> `ACCEPT`)
4. Wrap in `*filter` / `COMMIT`
