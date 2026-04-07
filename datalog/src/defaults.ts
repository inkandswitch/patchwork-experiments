import { parseProgram, serializeFacts, serializeRules, serializeConstraints } from './datalog';
import type { StoredFact, StoredRule, StoredConstraint } from './datalog';

export const DEFAULT_FACTS_TEXT = `
% --- Network zones ---
zone(dmz, "10.0.1.0/24").
zone(internal, "10.0.2.0/24").

% --- Machines: machine(name, ip, zone) ---
machine(web_srv, "10.0.1.10", dmz).
machine(app_srv, "10.0.2.10", internal).
machine(db_srv, "10.0.2.20", internal).

% --- Services: service(machine, port, protocol, name) ---
service(web_srv, 80, "tcp", http).
service(web_srv, 443, "tcp", https).
service(app_srv, 8080, "tcp", app_api).
service(db_srv, 5432, "tcp", postgres).

% --- Firewall rules: fw(index, action, source, dest_machine, protocol, dport) ---
fw(1, "accept", "0.0.0.0/0", web_srv, "tcp", 80).
fw(2, "accept", "0.0.0.0/0", web_srv, "tcp", 443).
fw(3, "accept", "10.0.1.0/24", app_srv, "tcp", 8080).
fw(4, "accept", "10.0.2.0/24", db_srv, "tcp", 5432).
fw(5, "drop", "0.0.0.0/0", db_srv, "tcp", 5432).
fw(6, "drop", "0.0.0.0/0", db_srv, "tcp", 3306).
fw(7, "accept", "10.0.2.10", db_srv, "tcp", 5432).
fw(8, "accept", "172.16.0.0/12", db_srv, "tcp", 5432).

% --- Blocked networks ---
blocked("10.99.0.0/16").
blocked("192.168.100.0/24").

% --- Trusted sources ---
trusted("10.0.2.0/24").
`.trim();

export const DEFAULT_RULES_TEXT = `
% --- Accessibility: which sources can reach which machine/port ---
accessible(Src, M, Port) :- fw(_, "accept", Src, M, _, Port).

% --- Externally exposed services ---
externally_exposed(M, Port, Name) :-
    service(M, Port, _, Name),
    fw(_, "accept", "0.0.0.0/0", M, _, Port).

% --- Redundant rules: earlier broader rule with same effect already covers ---
redundant(Idx) :-
    fw(Idx, Action, Src, Dest, Proto, Port),
    fw(Earlier, Action, Broader, Dest, Proto, Port),
    lt(Earlier, Idx),
    ip_in(Src, Broader).

% --- Unreachable rules: earlier DROP shadows a later ACCEPT ---
unreachable(Idx) :-
    fw(Idx, "accept", Src, Dest, _, Port),
    fw(Earlier, "drop", DropSrc, Dest, _, Port),
    lt(Earlier, Idx),
    ip_in(Src, DropSrc).

% --- Zone of a source CIDR ---
source_in_zone(Src, Zone) :- zone(Zone, Cidr), ip_in(Src, Cidr).
`.trim();

export const DEFAULT_CONSTRAINTS_TEXT = `
% Internal machines must not be directly exposed to the world
:- machine(M, _, internal), fw(_, "accept", "0.0.0.0/0", M, _, _).

% Blocked networks must not slip through any accept rule
:- blocked(Net), fw(_, "accept", Src, _, _, _), ip_in(Net, Src).

% No redundant firewall rules
:- redundant(Idx).

% No unreachable firewall rules
:- unreachable(Idx).
`.trim();

export const DEFAULT_FACTS: StoredFact[] = parseProgram(DEFAULT_FACTS_TEXT).facts;
export const DEFAULT_RULES: StoredRule[] = parseProgram(DEFAULT_RULES_TEXT).rules;
export const DEFAULT_CONSTRAINTS: StoredConstraint[] = parseProgram(DEFAULT_CONSTRAINTS_TEXT).constraints;
export const DEFAULT_PROGRAM_TEXT: string =
  serializeFacts(DEFAULT_FACTS) +
  '\n\n' +
  serializeRules(DEFAULT_RULES) +
  '\n\n' +
  serializeConstraints(DEFAULT_CONSTRAINTS);
