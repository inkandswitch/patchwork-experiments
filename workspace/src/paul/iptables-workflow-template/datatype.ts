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

type InitialToken = {
  placeId: string;
  state: Record<string, unknown>;
};

type PetriNetPlanDoc = {
  '@patchwork': { type: 'petrinet-plan' };
  initialTokens: InitialToken[];
  systemPromptUrls?: { optimizer?: string };
};

type MarkdownDoc = {
  '@patchwork': { type: 'markdown' };
  content: string;
};

export const IPTablesWorkflowTemplateDatatype: DatatypeImplementation<WorkflowDoc> = {
  init(doc: WorkflowDoc, repo: Repo) {
    const { elicitationUrl } = createElicitationWithIPTables(repo);
    const { specDocUrl } = createDefaultSpec(repo);

    doc.specElicitationDocUrl = elicitationUrl;
    doc.specDocUrl = specDocUrl;
    doc.planDocUrl = createPetriNetDoc(repo, specDocUrl);
    doc.toolIds = {
      spec: 'paul-spec-viewer',
    };
  },
  getTitle() {
    return 'IPTables Workflow';
  },
  setTitle() {},
};

function createElicitationWithIPTables(repo: Repo): {
  elicitationUrl: AutomergeUrl;
  referenceDocsFolderUrl: AutomergeUrl;
} {
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
    d.prompt =
      'Optimize the IPTables configurations for two machines (web server and database server) to remove redundant rules while maintaining the same security posture.';
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

function createFilesFolder(
  repo: Repo,
  title: string,
  files: { name: string; url: AutomergeUrl }[],
): AutomergeUrl {
  const handle = repo.create<FolderDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'folder' };
    d.title = title;
    d.docs = files.map((f) => ({ type: 'file', name: f.name, url: f.url }));
  });
  return handle.url;
}

function createPetriNetDoc(repo: Repo, specDocUrl: AutomergeUrl): AutomergeUrl {
  const handle = repo.create<PetriNetPlanDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'petrinet-plan' };
    d.initialTokens = [
      {
        placeId: 'spec',
        state: { type: 'spec', documentUrl: '', specUrl: specDocUrl },
      },
    ];
    d.systemPromptUrls = {
      optimizer: createMarkdownDoc(repo, IPTABLES_OPTIMIZER_SYSTEM_PROMPT),
    };
  });
  return handle.url;
}

function createMarkdownDoc(repo: Repo, content: string): string {
  const h = repo.create<MarkdownDoc>();
  h.change((d) => {
    d['@patchwork'] = { type: 'markdown' };
    d.content = content;
  });
  return h.url as string;
}

const IPTABLES_OPTIMIZER_SYSTEM_PROMPT = `You are a firewall configuration expert optimizing IPTables rules.

Your optimization strategy: $PROMPT

The specification is at $SPEC_URL. It is a Patchwork SpecDoc with:
- spec.goal: a description of the machine and its role
- spec.verificationUrls: array of Automerge URLs pointing to datalog docs with integrity constraints
- spec.filesFolderUrl: URL of a folder containing the original IPTables config files

The document at $DOC_URL is a markdown document containing an IPTables configuration (iptables-save format). Its structure:
- doc.content: string containing the full iptables-save output

Step 1 — Read the specification to understand the goal and constraints:
<script data-description="Read spec and verification rules">
const specHandle = await repo.find("$SPEC_URL")
const specDoc = await specHandle.doc()
const goal = specDoc.spec?.goal ?? ""
const verificationUrls = specDoc.spec?.verificationUrls ?? []
const verifications = await Promise.all(verificationUrls.map(async url => {
  const h = await repo.find(url)
  const d = await h.doc()
  return { url, title: d.title, draftText: d.draftText, constraints: d.constraints }
}))
return JSON.stringify({ goal, verifications }, null, 2)
</script>

Step 2 — Read the current IPTables configuration:
<script data-description="Read current IPTables config">
const handle = await repo.find("$DOC_URL")
const doc = await handle.doc()
return doc.content
</script>

Step 3 — Analyze the rules using your optimization strategy, then write the optimized configuration back:
<script data-description="Write optimized IPTables config">
const { updateText } = await import("@automerge/automerge-repo")
const handle = await repo.find("$DOC_URL")
handle.change(d => updateText(d, ["content"], \`*filter
:INPUT DROP [0:0]
:FORWARD DROP [0:0]
:OUTPUT ACCEPT [0:0]

# ... your optimized rules here ...

COMMIT\`))
return "Configuration updated"
</script>

Apply your strategy. Remove redundant rules while preserving the security posture required by the constraints. Do not explain — just compute and write.`;

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

function createDefaultSpec(repo: Repo): { specDocUrl: AutomergeUrl; leafSpecUrls: AutomergeUrl[] } {
  const globalRulesUrl = createDatalogDoc(repo, 'Global Firewall Rules', GLOBAL_RULES_DATALOG, [
    {
      body: [
        { pred: 'blocked_ip', args: ['IP'] },
        { pred: 'rule', args: ['M', '"input"', '_', '"accept"', 'Src', '_', '_'] },
        { pred: 'ip_in', args: ['IP', 'Src'] },
      ],
      comment: 'Blocked IPs must not be reachable via any allow rule',
    },
    {
      body: [{ pred: 'rule', args: ['M', '"input"', '_', '"accept"', '"0.0.0.0/0"', '_', '22'] }],
      comment: 'SSH (port 22) must be restricted to internal network',
    },
  ]);

  const commonMachineRulesUrl = createDatalogDoc(
    repo,
    'Common Machine Rules',
    COMMON_MACHINE_RULES_DATALOG,
    [
      {
        body: [{ pred: 'redundant', args: ['M', 'Idx'] }],
        comment: 'No redundant rules should exist',
      },
      {
        body: [{ pred: 'unreachable', args: ['M', 'Idx'] }],
        comment: 'No unreachable rules should exist',
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
          { pred: 'rule', args: ['M', '"input"', '_', '"accept"', '"0.0.0.0/0"', '_', '3306'] },
        ],
        comment: 'Web servers should not expose MySQL port',
      },
      {
        body: [
          { pred: 'role', args: ['M', 'webserver'] },
          { pred: 'rule', args: ['M', '"input"', '_', '"accept"', '"0.0.0.0/0"', '_', '5432'] },
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
          { pred: 'rule', args: ['M', '"input"', '_', '"accept"', '"0.0.0.0/0"', '_', '3306'] },
        ],
        comment: 'Database servers should only allow DB connections from internal network',
      },
      {
        body: [
          { pred: 'role', args: ['M', 'database'] },
          { pred: 'rule', args: ['M', '"input"', '_', '"accept"', '"0.0.0.0/0"', '_', '5432'] },
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

  return {
    specDocUrl: specHandle.url,
    leafSpecUrls: [machineASpecHandle.url, machineBSpecHandle.url],
  };
}

const GLOBAL_RULES_DATALOG = `% Network Configuration
machine(machine_a, "192.168.1.10").
machine(machine_b, "192.168.1.11").

% Blocked IPs (network-wide)
blocked_ip("10.0.0.1").
blocked_ip("10.0.0.2").

% Derive convenience relations
allows(M, Src, Port) :- rule(M, "input", _, "accept", Src, _, Port).
blocks(M, Src) :- rule(M, "input", _, "drop", Src, _, _).

% Blocked IPs must not be reachable via any allow rule
:- blocked_ip(IP), rule(M, "input", _, "accept", Src, _, _), ip_in(IP, Src).

% SSH (port 22) must be restricted to internal network
:- rule(M, "input", _, "accept", "0.0.0.0/0", _, 22).`;

const COMMON_MACHINE_RULES_DATALOG = `% Detect redundant rules (earlier broader rule with same action already covers)
redundant(M, Idx) :-
    rule(M, Chain, Idx, Action, Src, Proto, Port),
    rule(M, Chain, Earlier, Action, Broader, Proto, Port),
    lt(Earlier, Idx),
    ip_in(Src, Broader).

% Detect unreachable rules (earlier DROP shadows a later ACCEPT)
unreachable(M, Idx) :-
    rule(M, Chain, Idx, "accept", Src, _, _),
    rule(M, Chain, Earlier, "drop", DropSrc, _, _),
    lt(Earlier, Idx),
    ip_in(Src, DropSrc).

% No redundant rules should exist
:- redundant(M, Idx).

% No unreachable rules should exist
:- unreachable(M, Idx).`;

const MACHINE_A_RULES_DATALOG = `% Machine A is a web server
role(machine_a, webserver).

% Web servers should not expose database ports
:- role(M, webserver), rule(M, "input", _, "accept", "0.0.0.0/0", _, 3306).
:- role(M, webserver), rule(M, "input", _, "accept", "0.0.0.0/0", _, 5432).`;

const MACHINE_B_RULES_DATALOG = `% Machine B is a database server
role(machine_b, database).

% Database servers should only allow DB connections from internal network
:- role(M, database), rule(M, "input", _, "accept", "0.0.0.0/0", _, 3306).
:- role(M, database), rule(M, "input", _, "accept", "0.0.0.0/0", _, 5432).`;

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

const MACHINE_A_IPTABLES_DATALOG = `% Machine A IPTables Rules
% rule(Machine, Chain, Index, Action, Source, Protocol, DPort)

chain(machine_a, "input", "drop").
chain(machine_a, "forward", "drop").
chain(machine_a, "output", "accept").

% Loopback
rule(machine_a, "input", 1, "accept", "127.0.0.0/8", "any", "any").

% HTTP
rule(machine_a, "input", 2, "accept", "0.0.0.0/0", "tcp", 80).

% REDUNDANT: Duplicate HTTP rule
rule(machine_a, "input", 3, "accept", "0.0.0.0/0", "tcp", 80).

% HTTPS
rule(machine_a, "input", 4, "accept", "0.0.0.0/0", "tcp", 443).

% Alternative web ports
rule(machine_a, "input", 5, "accept", "0.0.0.0/0", "tcp", 8080).
rule(machine_a, "input", 6, "accept", "0.0.0.0/0", "tcp", 8443).

% SSH from internal network only
rule(machine_a, "input", 7, "accept", "192.168.1.0/24", "tcp", 22).

% REDUNDANT: Already covered by /24 above
rule(machine_a, "input", 8, "accept", "192.168.1.10", "tcp", 22).
rule(machine_a, "input", 9, "accept", "192.168.1.11", "tcp", 22).

% Block malicious IPs - broad CIDR
rule(machine_a, "input", 10, "drop", "10.0.0.0/8", "any", "any").

% REDUNDANT: Subsets of /8 above
rule(machine_a, "input", 11, "drop", "10.0.0.1", "any", "any").
rule(machine_a, "input", 12, "drop", "10.0.0.2", "any", "any").
rule(machine_a, "input", 13, "drop", "10.1.1.1", "any", "any").

% REDUNDANT: Unreachable - 10.0.0.5 blocked by /8 rule
rule(machine_a, "input", 14, "accept", "10.0.0.5", "tcp", 80).

% ICMP
rule(machine_a, "input", 15, "accept", "0.0.0.0/0", "icmp", "any").

% REDUNDANT: Duplicate ICMP rule
rule(machine_a, "input", 16, "accept", "0.0.0.0/0", "icmp", "any").`;

const MACHINE_B_IPTABLES_DATALOG = `% Machine B IPTables Rules
% rule(Machine, Chain, Index, Action, Source, Protocol, DPort)

chain(machine_b, "input", "drop").
chain(machine_b, "forward", "drop").
chain(machine_b, "output", "accept").

% Loopback
rule(machine_b, "input", 1, "accept", "127.0.0.0/8", "any", "any").

% REDUNDANT: Duplicate loopback
rule(machine_b, "input", 2, "accept", "127.0.0.0/8", "any", "any").

% MySQL from web server
rule(machine_b, "input", 3, "accept", "192.168.1.10", "tcp", 3306).

% PostgreSQL from web server
rule(machine_b, "input", 4, "accept", "192.168.1.10", "tcp", 5432).

% SSH from internal network
rule(machine_b, "input", 5, "accept", "192.168.1.0/24", "tcp", 22).

% REDUNDANT: Already covered by /24 above
rule(machine_b, "input", 6, "accept", "192.168.1.1", "tcp", 22).

% Block external access to DB ports
rule(machine_b, "input", 7, "drop", "0.0.0.0/0", "tcp", 3306).
rule(machine_b, "input", 8, "drop", "0.0.0.0/0", "tcp", 5432).

% REDUNDANT: Duplicate of above
rule(machine_b, "input", 9, "drop", "0.0.0.0/0", "tcp", 3306).
rule(machine_b, "input", 10, "drop", "0.0.0.0/0", "tcp", 5432).

% Block malicious IPs
rule(machine_b, "input", 11, "drop", "10.0.0.0/8", "any", "any").

% REDUNDANT: Subsets of /8 above
rule(machine_b, "input", 12, "drop", "10.0.0.0/16", "any", "any").
rule(machine_b, "input", 13, "drop", "10.0.0.0/24", "any", "any").

% REDUNDANT: Unreachable - 10.5.5.5 blocked by /8 rule above
rule(machine_b, "input", 14, "accept", "10.5.5.5", "tcp", 22).`;
