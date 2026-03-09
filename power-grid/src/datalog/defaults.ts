export const DEFAULT_FACTS_TEXT = `
% --- Topology ---
node(north, generator).
node(central, substation).
node(south, load).

% --- Transmission lines: edge(from, to, capacity_mw) ---
edge(north, central, 500).
edge(central, south, 600).

% --- Generation (explicit 0 for non-generators) ---
generates(north, 800).
generates(central, 0).
generates(south, 0).

% --- Consumption (explicit 0 for non-loads) ---
consumes(north, 0).
consumes(central, 50).
consumes(south, 400).

% --- Proposed flows ---
flow(north, central, 400).
flow(central, south, 350).

% --- Geographic positions: geopos(node, lat, lng) ---
geopos(north,   52.55, 13.37).
geopos(central, 52.52, 13.40).
geopos(south,   52.48, 13.43).
`.trim();

export const DEFAULT_RULES_TEXT = `
% --- Inflow / outflow aggregates ---
inflow(N, Total) :- sum(F, flow(_, N, F), Total).
outflow(N, Total) :- sum(F, flow(N, _, F), Total).

% --- Reachability ---
reachable(X, Y) :- edge(X, Y, _).
reachable(X, Z) :- reachable(X, Y), edge(Y, Z, _).

% --- Capacity constraints ---
valid_edge(X, Y) :- edge(X, Y, C), flow(X, Y, F), lte(F, C).
overloaded(X, Y) :- edge(X, Y, C), flow(X, Y, F), gt(F, C).

% --- Utilization ---
utilization(X, Y, Pct) :- edge(X, Y, C), flow(X, Y, F), div(F, C, Pct).
underutilized(X, Y) :- utilization(X, Y, Pct), lt(Pct, 0.5).

% --- Node conservation ---
node_balanced(N) :- inflow(N, In), outflow(N, Out), generates(N, G), consumes(N, C), add(In, G, Supply), add(Out, C, Demand), gte(Supply, Demand).

% --- Global balance ---
grid_balanced :- sum(G, generates(_, G), TotalGen), sum(C, consumes(_, C), TotalCon), gte(TotalGen, TotalCon).

% --- Net balance at a node ---
net_balance(N, B) :- generates(N, G), consumes(N, C), sub(G, C, B).
`.trim();
