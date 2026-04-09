import type { Plugin, Tool, Datatype } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool',
    id: 'workspace',
    name: 'Workspace',
    supportedDatatypes: ['workspace'],
    async load() {
      const { WorkspaceTool } = await import('./workspace/tool');
      return WorkspaceTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'workspace',
    name: 'Workspace',
    icon: 'Layout',
    async load() {
      const { WorkspaceDatatype } = await import('./workspace/datatype');
      return WorkspaceDatatype;
    },
  } as Datatype,
  {
    type: 'patchwork:tool',
    id: 'paul-spec-viewer',
    name: 'Paul Spec Viewer',
    supportedDatatypes: ['spec'],
    async load() {
      const { SpecTool } = await import('./paul/spec/tool');
      return SpecTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'spec',
    name: 'Spec',
    icon: 'FileText',
    async load() {
      const { SpecDatatype } = await import('./workflow/datatypes');
      return SpecDatatype;
    },
  } as Datatype,
  {
    type: 'patchwork:tool',
    id: 'spec-collection-viewer',
    name: 'Spec Collection',
    supportedDatatypes: ['spec-collection'],
    async load() {
      const { SpecTool } = await import('./old-spec/tool');
      return SpecTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'spec-collection',
    name: 'Spec Collection',
    icon: 'FileStack',
    async load() {
      const { SpecDatatype } = await import('./old-spec/datatype');
      return SpecDatatype;
    },
  } as Datatype,
  {
    type: 'patchwork:tool',
    id: 'paul-plan-viewer',
    name: 'Paul Plan Viewer',
    supportedDatatypes: ['plan'],
    async load() {
      const { PetriNetPlanTool } = await import('./paul/petrinet-plan/plan-tool');
      return PetriNetPlanTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'plan',
    name: 'Plan',
    icon: 'ListChecks',
    async load() {
      const { PlanDatatype } = await import('./workflow/datatypes');
      return PlanDatatype;
    },
  } as Datatype,
  {
    type: 'patchwork:tool',
    id: 'workspace-chat',
    name: 'Workspace Chat',
    supportedDatatypes: ['workspace-chat'],
    async load() {
      const { WorkspaceChatTool } = await import('./workspace-chat/tool');
      return WorkspaceChatTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'workspace-chat',
    name: 'Workspace Chat',
    icon: 'MessageSquare',
    async load() {
      const { WorkspaceChatDatatype } = await import('./workspace-chat/datatype');
      return WorkspaceChatDatatype;
    },
  } as Datatype,
  {
    type: 'patchwork:tool',
    id: 'workflow',
    name: 'Workflow',
    supportedDatatypes: ['workflow'],
    async load() {
      const { WorkflowTool } = await import('./workflow/tool');
      return WorkflowTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'workflow',
    name: 'Workflow',
    icon: 'Workflow',
    async load() {
      const { WorkflowDatatype } = await import('./workflow/datatypes');
      return WorkflowDatatype;
    },
  } as Datatype,
  {
    type: 'patchwork:tool',
    id: 'paul-workflow-template',
    name: 'Paul Workflow Template',
    supportedDatatypes: ['paul-workflow-template'],
    async load() {
      const { PaulWorkflowTemplateTool } = await import('./paul/workflow-template/tool');
      return PaulWorkflowTemplateTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'paul-workflow-template',
    name: 'Paul Workflow Template',
    icon: 'Workflow',
    async load() {
      const { PaulWorkflowTemplateDatatype } = await import('./paul/workflow-template/datatype');
      return PaulWorkflowTemplateDatatype;
    },
  } as Datatype,
  {
    type: 'patchwork:tool',
    id: 'validation',
    name: 'Validation',
    supportedDatatypes: ['validation'],
    async load() {
      const { ValidationTool } = await import('./paul/petrinet-plan/validation-tool');
      return ValidationTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'validation',
    name: 'Validation',
    icon: 'ShieldCheck',
    async load() {
      const { ValidationDatatype } = await import('./workflow/datatypes');
      return ValidationDatatype;
    },
  } as Datatype,
  {
    type: 'patchwork:tool',
    id: 'iptables-workflow-template',
    name: 'IPTables Workflow',
    supportedDatatypes: ['iptables-workflow-template'],
    async load() {
      const { IPTablesWorkflowTemplateTool } =
        await import('./paul/iptables-workflow-template/tool');
      return IPTablesWorkflowTemplateTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'iptables-workflow-template',
    name: 'IPTables Workflow',
    icon: 'Shield',
    async load() {
      const { IPTablesWorkflowTemplateDatatype } =
        await import('./paul/iptables-workflow-template/datatype');
      return IPTablesWorkflowTemplateDatatype;
    },
  } as Datatype,
  {
    type: 'patchwork:tool',
    id: 'elicitation-viewer',
    name: 'Elicitation',
    supportedDatatypes: ['elicitation'],
    async load() {
      const { ElicitationTool } = await import('./elicitation/tool');
      return ElicitationTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'elicitation',
    name: 'Elicitation',
    icon: 'MessageCircleQuestion',
    async load() {
      const { ElicitationDatatype } = await import('./elicitation/datatype');
      return ElicitationDatatype;
    },
  } as Datatype,
  {
    type: 'patchwork:tool',
    id: 'petrinet-plan',
    name: 'Petri Net Plan',
    supportedDatatypes: ['petrinet-plan'],
    async load() {
      const { PetriNetPlanTool } = await import('./paul/petrinet-plan/plan-tool');
      return PetriNetPlanTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'petrinet-plan',
    name: 'Petri Net Plan',
    icon: 'GitBranch',
    async load() {
      const { PetriNetPlanDatatype } = await import('./paul/petrinet-plan/datatype');
      return PetriNetPlanDatatype;
    },
  } as Datatype,
  {
    type: 'patchwork:tool',
    id: 'petrinet-execution',
    name: 'Petri Net Execution',
    supportedDatatypes: ['petrinet-execution'],
    async load() {
      const { PetriNetExecutionTool } = await import('./paul/petrinet-plan/execution-tool');
      return PetriNetExecutionTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'petrinet-execution',
    name: 'Petri Net Execution',
    icon: 'Play',
    async load() {
      const { PetriNetExecutionDatatype } = await import('./paul/petrinet-plan/execution-datatype');
      return PetriNetExecutionDatatype;
    },
  } as Datatype,
  {
    type: 'patchwork:tool',
    id: 'candidate-viewer',
    name: 'Candidate Viewer',
    supportedDatatypes: ['candidate'],
    async load() {
      const { CandidateTool } = await import('./paul/petrinet-plan/candidate-tool');
      return CandidateTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'candidate',
    name: 'Candidate',
    icon: 'CheckCircle',
    async load() {
      const { CandidateDatatype } = await import('./paul/petrinet-plan/candidate-datatype');
      return CandidateDatatype;
    },
  } as Datatype,
];

console.log('load workspace plugins', 4);
