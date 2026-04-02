import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { WorkflowDoc, SpecDoc, Spec } from '../../workflow/types';
import type { ElicitationDoc } from '../../types';

export type { WorkflowDoc } from '../../workflow/types';

type FolderDoc = {
  '@patchwork'?: { type: string };
  title: string;
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

type FileDoc = {
  '@patchwork': { type: 'file' };
  name: string;
  extension: string;
  mimeType: string;
  content: string;
};

type StoredAtom = { pred: string; args: string[] };
type StoredConstraint = { body: StoredAtom[]; comment?: string };

type DatalogDoc = {
  '@patchwork': { type: 'datalog' };
  title?: string;
  facts: unknown[];
  rules: unknown[];
  constraints: StoredConstraint[];
  derivedFacts?: unknown[];
  draftText?: string;
  mapStyle: { lines: Record<string, unknown>; properties: Record<string, unknown> };
};

type TokenInstance = { id: string; state: { type: string; documentUrl: string } };

type PetriNetPlanDoc = {
  '@patchwork': { type: 'petrinet-plan' };
  tokens: {
    candidates: TokenInstance[];
    optimizer_idle: TokenInstance[];
    optimizer_running: TokenInstance[];
    solutions: TokenInstance[];
    evaluator_idle: TokenInstance[];
    evaluator_running: TokenInstance[];
  };
};

export const IPTablesWorkflowTemplateDatatype: DatatypeImplementation<WorkflowDoc> = {
  init(doc: WorkflowDoc, repo: Repo) {
    const { elicitationUrl, referenceDocsFolderUrl } = createElicitationWithIPTables(repo);
    const { specDocUrl } = createDefaultSpec(repo);

    doc.specElicitationDocUrl = elicitationUrl;
    doc.specDocUrl = specDocUrl;
    doc.planDocUrl = createPetriNetDoc(repo);
    doc.toolIds = {
      spec: 'paul-spec-viewer',
    };
  },
  getTitle() {
    return 'IPTables Workflow';
  },
  setTitle() {},
};

function createElicitationWithIPTables(repo: Repo): { elicitationUrl: AutomergeUrl; referenceDocsFolderUrl: AutomergeUrl } {
  const machineAIptablesUrl = createFileDoc(
    repo,
    'machine-a-iptables',
    'rules',
    MACHINE_A_IPTABLES_RULES,
  );

  const machineBIptablesUrl = createFileDoc(
    repo,
    'machine-b-iptables',
    'rules',
    MACHINE_B_IPTABLES_RULES,
  );

  const folderHandle = repo.create<FolderDoc>();
  folderHandle.change((d) => {
    d['@patchwork'] = { type: 'folder' };
    d.title = 'IPTables Config Files';
    d.docs = [
      { type: 'file', name: 'machine-a-iptables.rules', url: machineAIptablesUrl },
      { type: 'file', name: 'machine-b-iptables.rules', url: machineBIptablesUrl },
    ];
  });

  const elicitationHandle = repo.create<ElicitationDoc>();
  elicitationHandle.change((d) => {
    d['@patchwork'] = { type: 'elicitation' };
    d.prompt = 'Optimize the IPTables configurations for two machines (web server and database server) to remove redundant rules while maintaining the same security posture.';
    d.referenceDocsFolderUrl = folderHandle.url;
  });

  return { elicitationUrl: elicitationHandle.url, referenceDocsFolderUrl: folderHandle.url };
}

function createFileDoc(repo: Repo, name: string, extension: string, content: string): AutomergeUrl {
  const handle = repo.create<FileDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'file' };
    d.name = name;
    d.extension = extension;
    d.mimeType = 'text/plain';
    d.content = content;
  });
  return handle.url;
}

function createFilesFolder(repo: Repo, title: string, files: { name: string; url: AutomergeUrl }[]): AutomergeUrl {
  const handle = repo.create<FolderDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'folder' };
    d.title = title;
    d.docs = files.map((f) => ({ type: 'file', name: f.name, url: f.url }));
  });
  return handle.url;
}

function createPetriNetDoc(repo: Repo): AutomergeUrl {
  const handle = repo.create<PetriNetPlanDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'petrinet-plan' };
    d.tokens = {
      candidates: [],
      optimizer_idle: [],
      optimizer_running: [],
      solutions: [],
      evaluator_idle: [],
      evaluator_running: [],
    };
  });
  return handle.url;
}

function createDatalogDoc(
  repo: Repo,
  title: string,
  draftText: string,
  constraints: StoredConstraint[],
): AutomergeUrl {
  const handle = repo.create<DatalogDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'datalog' };
    d.title = title;
    d.facts = [];
    d.rules = [];
    d.constraints = constraints;
    d.draftText = draftText;
    d.mapStyle = { lines: {}, properties: {} };
  });
  return handle.url;
}

function createDefaultSpec(repo: Repo): { specDocUrl: AutomergeUrl } {
  const globalRulesUrl = createDatalogDoc(
    repo,
    'Global Firewall Rules',
    GLOBAL_RULES_DATALOG,
    [
      {
        body: [
          { pred: 'machine', args: ['M', '_'] },
          { pred: 'blocked_ip', args: ['IP'] },
          { pred: 'allows', args: ['M', 'IP', '_'] },
        ],
        comment: 'Global constraint: blocked IPs must not be allowed on any machine',
      },
      {
        body: [
          { pred: 'machine', args: ['M', '_'] },
          { pred: 'allows', args: ['M', '"0.0.0.0/0"', '22'] },
        ],
        comment: 'Global constraint: SSH (port 22) must be restricted to internal network',
      },
    ],
  );

  const commonMachineRulesUrl = createDatalogDoc(
    repo,
    'Common Machine Rules',
    COMMON_MACHINE_RULES_DATALOG,
    [
      {
        body: [
          { pred: 'machine', args: ['M', '_'] },
          { pred: 'not', args: ['allows(M, "127.0.0.1", _)'] },
        ],
        comment: 'Constraint: loopback must always be allowed',
      },
      {
        body: [
          { pred: 'machine', args: ['M', '_'] },
          { pred: 'blocks', args: ['M', '"0.0.0.0/0"', 'icmp', 'echo'] },
        ],
        comment: 'Constraint: ICMP echo should be rate-limited (not blocked entirely)',
      },
    ],
  );

  const machineARulesUrl = createDatalogDoc(
    repo,
    'Machine A Rules (Web Server)',
    MACHINE_A_RULES_DATALOG,
    [
      {
        body: [
          { pred: 'role', args: ['M', 'webserver'] },
          { pred: 'not', args: ['allows(M, "0.0.0.0/0", 80)'] },
        ],
        comment: 'Web servers must allow HTTP',
      },
      {
        body: [
          { pred: 'role', args: ['M', 'webserver'] },
          { pred: 'not', args: ['allows(M, "0.0.0.0/0", 443)'] },
        ],
        comment: 'Web servers must allow HTTPS',
      },
      {
        body: [
          { pred: 'role', args: ['M', 'webserver'] },
          { pred: 'allows', args: ['M', '"0.0.0.0/0"', '3306'] },
        ],
        comment: 'Web servers should not expose MySQL port',
      },
      {
        body: [
          { pred: 'role', args: ['M', 'webserver'] },
          { pred: 'allows', args: ['M', '"0.0.0.0/0"', '5432'] },
        ],
        comment: 'Web servers should not expose PostgreSQL port',
      },
    ],
  );

  const machineBRulesUrl = createDatalogDoc(
    repo,
    'Machine B Rules (Database Server)',
    MACHINE_B_RULES_DATALOG,
    [
      {
        body: [
          { pred: 'role', args: ['M', 'database'] },
          { pred: 'allows', args: ['M', '"0.0.0.0/0"', '3306'] },
        ],
        comment: 'Database servers should only allow DB connections from internal network',
      },
      {
        body: [
          { pred: 'role', args: ['M', 'database'] },
          { pred: 'allows', args: ['M', '"0.0.0.0/0"', '5432'] },
        ],
        comment: 'Database servers should only allow DB connections from internal network',
      },
    ],
  );

  const machineADatalogFileUrl = createFileDoc(
    repo,
    'machine-a-iptables',
    'datalog',
    MACHINE_A_IPTABLES_DATALOG,
  );

  const machineBDatalogFileUrl = createFileDoc(
    repo,
    'machine-b-iptables',
    'datalog',
    MACHINE_B_IPTABLES_DATALOG,
  );

  const machineAFilesFolderUrl = createFilesFolder(repo, 'Machine A Files', [
    { name: 'machine-a-iptables.datalog', url: machineADatalogFileUrl },
  ]);

  const machineBFilesFolderUrl = createFilesFolder(repo, 'Machine B Files', [
    { name: 'machine-b-iptables.datalog', url: machineBDatalogFileUrl },
  ]);

  const machineASpecHandle = repo.create<SpecDoc>();
  machineASpecHandle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.spec = {
      goal: 'Machine A Firewall (Web Server)',
      verificationUrls: [commonMachineRulesUrl, machineARulesUrl],
      filesFolderUrl: machineAFilesFolderUrl,
    };
  });

  const machineBSpecHandle = repo.create<SpecDoc>();
  machineBSpecHandle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.spec = {
      goal: 'Machine B Firewall (Database Server)',
      verificationUrls: [commonMachineRulesUrl, machineBRulesUrl],
      filesFolderUrl: machineBFilesFolderUrl,
    };
  });

  const spec: Spec = {
    goal: 'Network Firewall Configuration',
    verificationUrls: [globalRulesUrl],
    subSpecUrls: [machineASpecHandle.url, machineBSpecHandle.url],
  };

  const specHandle = repo.create<SpecDoc>();
  specHandle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.spec = spec;
  });

  return { specDocUrl: specHandle.url };
}

const GLOBAL_RULES_DATALOG = `% Network Configuration
machine(machine_a, "192.168.1.10").
machine(machine_b, "192.168.1.11").

% Blocked IPs (network-wide)
blocked_ip("10.0.0.1").
blocked_ip("10.0.0.2").

% Global constraint: blocked IPs must not be allowed on any machine
:- machine(M, _), blocked_ip(IP), allows(M, IP, _).

% Global constraint: SSH (port 22) must be restricted to internal network
:- machine(M, _), allows(M, "0.0.0.0/0", 22).`;

const COMMON_MACHINE_RULES_DATALOG = `% Standard ports that should be open
standard_port(80).   % HTTP
standard_port(443).  % HTTPS

% Constraint: loopback must always be allowed
:- machine(M, _), not(allows(M, "127.0.0.1", _)).

% Constraint: ICMP echo should be rate-limited (not blocked entirely)
:- machine(M, _), blocks(M, "0.0.0.0/0", icmp, echo).`;

const MACHINE_A_RULES_DATALOG = `% Machine A is a web server
role(machine_a, webserver).

% Web servers must allow HTTP/HTTPS
:- role(M, webserver), not(allows(M, "0.0.0.0/0", 80)).
:- role(M, webserver), not(allows(M, "0.0.0.0/0", 443)).

% Web servers should not expose database ports
:- role(M, webserver), allows(M, "0.0.0.0/0", 3306).
:- role(M, webserver), allows(M, "0.0.0.0/0", 5432).`;

const MACHINE_B_RULES_DATALOG = `% Machine B is a database server
role(machine_b, database).

% Database servers should only allow DB connections from internal network
:- role(M, database), allows(M, "0.0.0.0/0", 3306).
:- role(M, database), allows(M, "0.0.0.0/0", 5432).

% Database servers must allow connections from web servers
:- role(M, database), machine(WebServer, IP), role(WebServer, webserver), 
   not(allows(M, IP, 3306)).`;

const MACHINE_A_IPTABLES_RULES = `*filter
:INPUT DROP [0:0]
:FORWARD DROP [0:0]
:OUTPUT ACCEPT [0:0]

# Allow loopback
-A INPUT -i lo -j ACCEPT

# Allow established connections
-A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow HTTP
-A INPUT -p tcp --dport 80 -j ACCEPT

# REDUNDANT: Duplicate HTTP rule (same as above)
-A INPUT -p tcp --dport 80 -j ACCEPT

# Allow HTTPS
-A INPUT -p tcp --dport 443 -j ACCEPT

# REDUNDANT: Could be combined with HTTP/HTTPS above using multiport
-A INPUT -p tcp --dport 8080 -j ACCEPT
-A INPUT -p tcp --dport 8443 -j ACCEPT

# Allow SSH from internal network only
-A INPUT -p tcp -s 192.168.1.0/24 --dport 22 -j ACCEPT

# REDUNDANT: More specific rule already covered by above
-A INPUT -p tcp -s 192.168.1.10 --dport 22 -j ACCEPT
-A INPUT -p tcp -s 192.168.1.11 --dport 22 -j ACCEPT

# Block known malicious IPs
-A INPUT -s 10.0.0.0/8 -j DROP

# REDUNDANT: These are already blocked by the /8 CIDR above
-A INPUT -s 10.0.0.1 -j DROP
-A INPUT -s 10.0.0.2 -j DROP
-A INPUT -s 10.1.1.1 -j DROP

# REDUNDANT: Unreachable rule - 10.0.0.5 is already blocked by /8 above
-A INPUT -s 10.0.0.5 -p tcp --dport 80 -j ACCEPT

# Rate limit ICMP
-A INPUT -p icmp --icmp-type echo-request -m limit --limit 1/s -j ACCEPT

# REDUNDANT: Duplicate ICMP rule
-A INPUT -p icmp --icmp-type echo-request -m limit --limit 1/s -j ACCEPT

# REDUNDANT: Shadowed by default DROP policy - these explicit drops are unnecessary
-A INPUT -p tcp --dport 23 -j DROP
-A INPUT -p tcp --dport 21 -j DROP

COMMIT`;

const MACHINE_B_IPTABLES_RULES = `*filter
:INPUT DROP [0:0]
:FORWARD DROP [0:0]
:OUTPUT ACCEPT [0:0]

# Allow loopback
-A INPUT -i lo -j ACCEPT

# REDUNDANT: Duplicate loopback rule
-A INPUT -i lo -j ACCEPT

# Allow established connections
-A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow MySQL from web server
-A INPUT -p tcp -s 192.168.1.10 --dport 3306 -j ACCEPT

# REDUNDANT: Same source, could be combined with MySQL rule above
-A INPUT -p tcp -s 192.168.1.10 --dport 5432 -j ACCEPT

# Allow SSH from internal network
-A INPUT -p tcp -s 192.168.1.0/24 --dport 22 -j ACCEPT

# REDUNDANT: Already covered by /24 rule above
-A INPUT -p tcp -s 192.168.1.1 --dport 22 -j ACCEPT

# Block external access to DB ports
-A INPUT -p tcp --dport 3306 -j DROP
-A INPUT -p tcp --dport 5432 -j DROP

# REDUNDANT: Shadowed by default DROP - these would never match anyway
-A INPUT -p tcp --dport 3306 -j DROP
-A INPUT -p tcp --dport 5432 -j DROP

# Block malicious IPs
-A INPUT -s 10.0.0.0/8 -j DROP

# REDUNDANT: Subset of /8 block above
-A INPUT -s 10.0.0.0/16 -j DROP
-A INPUT -s 10.0.0.0/24 -j DROP

# REDUNDANT: Order issue - this ACCEPT is after DROP, so unreachable
-A INPUT -s 10.5.5.5 -p tcp --dport 22 -j ACCEPT

COMMIT`;

const MACHINE_A_IPTABLES_DATALOG = `% Machine A IPTables Rules (Datalog representation)
chain(input, drop).
chain(forward, drop).
chain(output, accept).

% Loopback rule
rule(input, 1, accept, interface(lo), any, any).

% Established connections
rule(input, 2, accept, any, any, state(established, related)).

% HTTP
rule(input, 3, accept, any, tcp, dport(80)).

% REDUNDANT: Duplicate HTTP rule
rule(input, 4, accept, any, tcp, dport(80)).

% HTTPS
rule(input, 5, accept, any, tcp, dport(443)).

% REDUNDANT: Could be combined with multiport
rule(input, 6, accept, any, tcp, dport(8080)).
rule(input, 7, accept, any, tcp, dport(8443)).

% SSH from internal
rule(input, 8, accept, src("192.168.1.0/24"), tcp, dport(22)).

% REDUNDANT: Already covered by /24 above
rule(input, 9, accept, src("192.168.1.10"), tcp, dport(22)).
rule(input, 10, accept, src("192.168.1.11"), tcp, dport(22)).

% Block malicious IPs - broad CIDR
rule(input, 11, drop, src("10.0.0.0/8"), any, any).

% REDUNDANT: Subsets of /8 above
rule(input, 12, drop, src("10.0.0.1"), any, any).
rule(input, 13, drop, src("10.0.0.2"), any, any).
rule(input, 14, drop, src("10.1.1.1"), any, any).

% REDUNDANT: Unreachable - 10.0.0.5 blocked by /8 rule
rule(input, 15, accept, src("10.0.0.5"), tcp, dport(80)).

% ICMP rate limit
rule(input, 16, accept, any, icmp, icmp_type(echo_request), limit(1, second)).

% REDUNDANT: Duplicate ICMP rule
rule(input, 17, accept, any, icmp, icmp_type(echo_request), limit(1, second)).

% REDUNDANT: Shadowed by default DROP policy
rule(input, 18, drop, any, tcp, dport(23)).
rule(input, 19, drop, any, tcp, dport(21)).`;

const MACHINE_B_IPTABLES_DATALOG = `% Machine B IPTables Rules (Datalog representation)
chain(input, drop).
chain(forward, drop).
chain(output, accept).

% Loopback rule
rule(input, 1, accept, interface(lo), any, any).

% REDUNDANT: Duplicate loopback
rule(input, 2, accept, interface(lo), any, any).

% Established connections
rule(input, 3, accept, any, any, state(established, related)).

% MySQL from web server
rule(input, 4, accept, src("192.168.1.10"), tcp, dport(3306)).

% REDUNDANT: Same source, could combine
rule(input, 5, accept, src("192.168.1.10"), tcp, dport(5432)).

% SSH from internal
rule(input, 6, accept, src("192.168.1.0/24"), tcp, dport(22)).

% REDUNDANT: Already covered by /24
rule(input, 7, accept, src("192.168.1.1"), tcp, dport(22)).

% Block external DB ports
rule(input, 8, drop, any, tcp, dport(3306)).
rule(input, 9, drop, any, tcp, dport(5432)).

% REDUNDANT: Duplicate of above (shadowed)
rule(input, 10, drop, any, tcp, dport(3306)).
rule(input, 11, drop, any, tcp, dport(5432)).

% Block malicious IPs
rule(input, 12, drop, src("10.0.0.0/8"), any, any).

% REDUNDANT: Subsets of /8 above
rule(input, 13, drop, src("10.0.0.0/16"), any, any).
rule(input, 14, drop, src("10.0.0.0/24"), any, any).

% REDUNDANT: Unreachable - 10.5.5.5 blocked by /8 rule above
rule(input, 15, accept, src("10.5.5.5"), tcp, dport(22)).`;
