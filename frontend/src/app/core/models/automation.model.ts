export type FlowNodeType = 'trigger' | 'condition' | 'action';

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  title: string;
  subtitle?: string;
  x: number;
  y: number;
  config: Record<string, any>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface AutomationFlow {
  id: number;
  name: string;
  description: string;
  trigger_type: string;
  is_active: boolean;
  nodes: FlowNode[];
  edges: FlowEdge[];
  execution_count: number;
  last_executed_at?: string;
  created_at?: string;
  updated_at?: string;
  logs?: AutomationLog[];
}

export interface AutomationLog {
  id: number;
  automation_id: number;
  automation_name?: string;
  trigger_type?: string;
  status: 'success' | 'warning' | 'skipped' | 'error';
  summary: string;
  details?: {
    steps?: Array<{
      nodeId: string;
      type: string;
      title: string;
      status: string;
      message: string;
    }>;
    actionMessages?: string[];
    inputContext?: any;
  };
  created_at: string;
}

export interface ExecutionStepTrace {
  nodeId: string;
  type: string;
  title: string;
  status: 'passed' | 'failed' | 'executed' | 'skipped';
  message: string;
}

export interface AutomationExecutionResult {
  flowId: number;
  flowName: string;
  status: 'success' | 'skipped' | 'error';
  passed: boolean;
  summary: string;
  steps: ExecutionStepTrace[];
  actionMessages: string[];
}

export interface FlowTemplate {
  name: string;
  description: string;
  trigger_type: string;
  category: 'kanban' | 'cms' | 'cross_platform';
  badge: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}
