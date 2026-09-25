import { Component, inject, OnInit, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AutomationService } from '../../core/services/automation.service';
import { BoardService } from '../../core/services/board.service';
import { CmsService } from '../../core/services/cms.service';
import {
  AutomationFlow,
  FlowNode,
  FlowEdge,
  FlowNodeType,
  AutomationLog,
  AutomationExecutionResult,
  FlowTemplate
} from '../../core/models/automation.model';

@Component({
  selector: 'app-automation-flow',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './automation-flow.component.html',
  styleUrls: ['./automation-flow.component.css']
})
export class AutomationFlowComponent implements OnInit {
  automationService = inject(AutomationService);
  boardService = inject(BoardService);
  cmsService = inject(CmsService);

  // Canvas State
  selectedNode = signal<FlowNode | null>(null);
  selectedEdge = signal<FlowEdge | null>(null);
  showLogsDrawer = signal<boolean>(false);
  showTemplateModal = signal<boolean>(false);
  showTestModal = signal<boolean>(false);
  saveSuccessToast = signal<string | null>(null);

  // Dragging state
  draggingNodeId: string | null = null;
  dragOffset = { x: 0, y: 0 };
  isWireAnimating = signal<boolean>(false);

  // Connecting / Linking State
  connectingSourceNode = signal<FlowNode | null>(null);
  connectingMousePos = signal<{ x: number; y: number } | null>(null);
  hoveredTargetNode = signal<FlowNode | null>(null);
  targetSelectForNode = '';

  // Template Library
  templates: FlowTemplate[] = [
    {
      name: 'Auto-Move to Done on Checklist Completion',
      description: 'Automatically transitions card into the "Done" column when all checklist items are ticked.',
      trigger_type: 'checklist_completed',
      category: 'kanban',
      badge: 'POPULAR',
      nodes: [
        {
          id: 't_node_1',
          type: 'trigger',
          title: 'Checklist Completed',
          subtitle: 'All items marked 100% complete',
          x: 60,
          y: 160,
          config: { event: 'checklist_completed' }
        },
        {
          id: 't_node_2',
          type: 'condition',
          title: 'Not in Done Column',
          subtitle: 'Card is not already in Done',
          x: 420,
          y: 160,
          config: { field: 'column_name', operator: 'not_equals', value: 'Done' }
        },
        {
          id: 't_node_3',
          type: 'action',
          title: 'Move Card to Done',
          subtitle: 'Move card and log activity',
          x: 780,
          y: 160,
          config: { action_type: 'move_card_column', target_column: 'Done', add_activity: 'Auto-moved to Done on checklist completion' }
        }
      ],
      edges: [
        { id: 't_e_1', source: 't_node_1', target: 't_node_2' },
        { id: 't_e_2', source: 't_node_2', target: 't_node_3' }
      ]
    },
    {
      name: 'Urgent Bug Escalator',
      description: 'Detects bug reports or urgent tags and raises priority to Urgent at top of Backlog.',
      trigger_type: 'card_updated',
      category: 'kanban',
      badge: 'RECOMMENDED',
      nodes: [
        {
          id: 'b_node_1',
          type: 'trigger',
          title: 'Card Created / Updated',
          subtitle: 'Any card updates or new tickets',
          x: 60,
          y: 160,
          config: { event: 'card_updated' }
        },
        {
          id: 'b_node_2',
          type: 'condition',
          title: 'Contains "bug" or "urgent"',
          subtitle: 'Checks title and description',
          x: 420,
          y: 160,
          config: { field: 'title_or_desc', operator: 'contains', value: 'bug' }
        },
        {
          id: 'b_node_3',
          type: 'action',
          title: 'Escalate to Urgent',
          subtitle: 'Set priority to Urgent',
          x: 780,
          y: 160,
          config: { action_type: 'set_priority', priority: 'urgent', add_activity: 'Priority escalated to Urgent via automation rule' }
        }
      ],
      edges: [
        { id: 'b_e_1', source: 'b_node_1', target: 'b_node_2' },
        { id: 'b_e_2', source: 'b_node_2', target: 'b_node_3' }
      ]
    },
    {
      name: 'CMS Publish -> Kanban QA Verification',
      description: 'Creates a verification card in the Kanban Review column whenever a site page is published.',
      trigger_type: 'cms_page_published',
      category: 'cross_platform',
      badge: 'CROSS-APP',
      nodes: [
        {
          id: 'c_node_1',
          type: 'trigger',
          title: 'CMS Page Published',
          subtitle: 'When page status becomes Published',
          x: 60,
          y: 160,
          config: { event: 'cms_page_published' }
        },
        {
          id: 'c_node_2',
          type: 'condition',
          title: 'Page Status is Published',
          subtitle: 'Verify live publication',
          x: 420,
          y: 160,
          config: { field: 'status', operator: 'equals', value: 'published' }
        },
        {
          id: 'c_node_3',
          type: 'action',
          title: 'Create Board QA Card',
          subtitle: 'Creates card in Review column',
          x: 780,
          y: 160,
          config: { action_type: 'create_card', target_column: 'Review', title_prefix: 'Verify Live SEO: ', priority: 'high' }
        }
      ],
      edges: [
        { id: 'c_e_1', source: 'c_node_1', target: 'c_node_2' },
        { id: 'c_e_2', source: 'c_node_2', target: 'c_node_3' }
      ]
    }
  ];

  ngOnInit() {
    this.loadAutomations();
    this.loadRecentLogs();
  }

  loadAutomations() {
    this.automationService.getAutomations().subscribe({
      next: (list) => {
        if (list.length > 0 && !this.selectedNode() && list[0].nodes.length > 0) {
          this.selectedNode.set(list[0].nodes[0]);
        }
      },
      error: (err) => console.error('Error loading automations:', err)
    });
  }

  loadRecentLogs() {
    this.automationService.getRecentLogs().subscribe({
      error: (err) => console.error('Error loading logs:', err)
    });
  }

  selectFlow(flow: AutomationFlow) {
    this.automationService.activeFlow.set(flow);
    this.selectedNode.set(flow.nodes.length > 0 ? flow.nodes[0] : null);
    this.selectedEdge.set(null);
  }

  toggleActive(flow: AutomationFlow, event?: Event) {
    if (event) event.stopPropagation();
    this.automationService.toggleAutomation(flow.id).subscribe({
      next: () => {
        this.showToast(`Automation "${flow.name}" is now ${flow.is_active ? 'active' : 'paused'}`);
      }
    });
  }

  createNewFlow() {
    const name = prompt('Automation Flow Name:', 'New Automation Flow');
    if (!name || !name.trim()) return;

    const initialNodes: FlowNode[] = [
      {
        id: `node_${Date.now()}_1`,
        type: 'trigger',
        title: 'Checklist Completed',
        subtitle: 'When card checklist reaches 100%',
        x: 80,
        y: 160,
        config: { event: 'checklist_completed' }
      },
      {
        id: `node_${Date.now()}_2`,
        type: 'condition',
        title: 'Column Filter',
        subtitle: 'Card not yet in Done',
        x: 440,
        y: 160,
        config: { field: 'column_name', operator: 'not_equals', value: 'Done' }
      },
      {
        id: `node_${Date.now()}_3`,
        type: 'action',
        title: 'Move to Done Column',
        subtitle: 'Transition card to Done',
        x: 800,
        y: 160,
        config: { action_type: 'move_card_column', target_column: 'Done' }
      }
    ];

    const initialEdges: FlowEdge[] = [
      { id: `edge_${Date.now()}_1`, source: initialNodes[0].id, target: initialNodes[1].id },
      { id: `edge_${Date.now()}_2`, source: initialNodes[1].id, target: initialNodes[2].id }
    ];

    this.automationService.createAutomation({
      name: name.trim(),
      description: 'Custom automated rule',
      trigger_type: 'checklist_completed',
      is_active: true,
      nodes: initialNodes,
      edges: initialEdges
    }).subscribe({
      next: (res) => {
        this.loadAutomations();
        this.showToast('Created new automation flow');
      }
    });
  }

  deleteCurrentFlow() {
    const flow = this.automationService.activeFlow();
    if (!flow) return;
    if (!confirm(`Are you sure you want to delete "${flow.name}"?`)) return;

    this.automationService.deleteAutomation(flow.id).subscribe({
      next: () => {
        this.showToast('Automation flow deleted');
        this.loadAutomations();
      }
    });
  }

  applyTemplate(template: FlowTemplate) {
    const flow = this.automationService.activeFlow();
    if (!flow) return;

    flow.name = template.name;
    flow.description = template.description;
    flow.trigger_type = template.trigger_type;
    flow.nodes = JSON.parse(JSON.stringify(template.nodes));
    flow.edges = JSON.parse(JSON.stringify(template.edges));

    this.saveCurrentFlow();
    this.showTemplateModal.set(false);
    this.showToast(`Applied template "${template.name}"`);
  }

  // Canvas Node Operations
  addNode(type: FlowNodeType) {
    const flow = this.automationService.activeFlow();
    if (!flow) return;

    const count = flow.nodes.filter(n => n.type === type).length;
    let title = '';
    let subtitle = '';
    let config: Record<string, any> = {};
    let defaultX = 200;
    let defaultY = 160 + count * 60;

    if (type === 'trigger') {
      title = 'Trigger Event';
      subtitle = 'When event occurs';
      config = { event: 'card_updated' };
      defaultX = 60;
    } else if (type === 'condition') {
      title = 'Rule Condition';
      subtitle = 'Verify criteria';
      config = { field: 'column_name', operator: 'equals', value: 'In Progress' };
      defaultX = 430;
    } else {
      title = 'Execute Action';
      subtitle = 'Perform target action';
      config = { action_type: 'move_card_column', target_column: 'Done' };
      defaultX = 800;
    }

    const newNode: FlowNode = {
      id: `node_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type,
      title,
      subtitle,
      x: defaultX,
      y: defaultY,
      config
    };

    flow.nodes.push(newNode);
    this.selectedNode.set(newNode);
    this.saveCurrentFlow();
  }

  deleteNode(node: FlowNode) {
    const flow = this.automationService.activeFlow();
    if (!flow) return;

    flow.nodes = flow.nodes.filter(n => n.id !== node.id);
    flow.edges = flow.edges.filter(e => e.source !== node.id && e.target !== node.id);

    if (this.selectedNode()?.id === node.id) {
      this.selectedNode.set(flow.nodes.length > 0 ? flow.nodes[0] : null);
    }
    this.saveCurrentFlow();
    this.showToast('Node removed');
  }

  connectNodes(sourceNodeId: string, targetNodeId: string) {
    const flow = this.automationService.activeFlow();
    if (!flow || sourceNodeId === targetNodeId) return;

    const exists = flow.edges.some(e => e.source === sourceNodeId && e.target === targetNodeId);
    if (!exists) {
      flow.edges.push({
        id: `edge_${Date.now()}`,
        source: sourceNodeId,
        target: targetNodeId
      });
      this.saveCurrentFlow();
    }
  }

  deleteEdge(edge: FlowEdge) {
    const flow = this.automationService.activeFlow();
    if (!flow) return;
    flow.edges = flow.edges.filter(e => e.id !== edge.id);
    this.selectedEdge.set(null);
    this.saveCurrentFlow();
  }

  // Node Drag & Drop
  startDragNode(node: FlowNode, event: MouseEvent) {
    // Only drag on header or card body, not inside inputs, buttons, or ports
    const target = event.target as HTMLElement;
    if (['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(target.tagName)) return;
    if (target.classList.contains('node-port')) return;

    this.draggingNodeId = node.id;
    this.selectedNode.set(node);
    this.dragOffset = {
      x: event.clientX - node.x,
      y: event.clientY - node.y
    };
    event.stopPropagation();
  }

  // Interactive Linking / Port Connections
  startConnecting(node: FlowNode, portType: 'output' | 'input', event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    this.connectingSourceNode.set(node);
    const canvas = document.getElementById('flowCanvas');
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      this.connectingMousePos.set({
        x: event.clientX - rect.left + canvas.scrollLeft,
        y: event.clientY - rect.top + canvas.scrollTop
      });
    }
  }

  onOutputPortClick(node: FlowNode, event: MouseEvent) {
    event.stopPropagation();
    if (this.connectingSourceNode()?.id === node.id) {
      this.cancelConnecting();
    } else {
      this.startConnecting(node, 'output', event);
    }
  }

  onInputPortClick(node: FlowNode, event: MouseEvent) {
    event.stopPropagation();
    if (this.connectingSourceNode()) {
      this.completeConnection(node, event);
    }
  }

  onInputPortMouseDown(node: FlowNode, event: MouseEvent) {
    event.stopPropagation();
  }

  onPortMouseEnter(node: FlowNode, portType: 'input' | 'output') {
    if (this.connectingSourceNode() && this.connectingSourceNode()?.id !== node.id) {
      this.hoveredTargetNode.set(node);
    }
  }

  onPortMouseLeave(node: FlowNode) {
    if (this.hoveredTargetNode()?.id === node.id) {
      this.hoveredTargetNode.set(null);
    }
  }

  completeConnection(targetNode: FlowNode, event?: MouseEvent) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    const src = this.connectingSourceNode();
    if (src && src.id !== targetNode.id) {
      this.connectNodes(src.id, targetNode.id);
      this.showToast(`Linked: ${src.title} → ${targetNode.title}`);
    }
    this.cancelConnecting();
  }

  cancelConnecting() {
    this.connectingSourceNode.set(null);
    this.connectingMousePos.set(null);
    this.hoveredTargetNode.set(null);
  }

  onCanvasClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('.node-port') || target.closest('.flow-node-card') || target.closest('.flow-wire-base') || target.closest('.wire-delete-badge')) {
      return;
    }
    if (this.connectingSourceNode()) {
      this.cancelConnecting();
    } else {
      this.selectedNode.set(null);
      this.selectedEdge.set(null);
    }
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (this.draggingNodeId) {
      const flow = this.automationService.activeFlow();
      if (!flow) return;

      const node = flow.nodes.find(n => n.id === this.draggingNodeId);
      if (node) {
        node.x = Math.max(20, Math.min(1800, event.clientX - this.dragOffset.x));
        node.y = Math.max(20, Math.min(1200, event.clientY - this.dragOffset.y));
      }
    } else if (this.connectingSourceNode()) {
      const canvas = document.getElementById('flowCanvas');
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        this.connectingMousePos.set({
          x: event.clientX - rect.left + canvas.scrollLeft,
          y: event.clientY - rect.top + canvas.scrollTop
        });
      }
    }
  }

  @HostListener('window:mouseup', ['$event'])
  onMouseUp(event?: MouseEvent) {
    if (this.draggingNodeId) {
      this.draggingNodeId = null;
      this.saveCurrentFlow();
    }
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.cancelConnecting();
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedEdge()) {
      const target = event.target as HTMLElement;
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        this.deleteEdge(this.selectedEdge()!);
      }
    }
  }

  // SVG Connection Path Generation
  getEdgePath(edge: FlowEdge): string {
    const flow = this.automationService.activeFlow();
    if (!flow) return '';

    const source = flow.nodes.find(n => n.id === edge.source);
    const target = flow.nodes.find(n => n.id === edge.target);
    if (!source || !target) return '';

    const nodeWidth = 250;
    const nodeHeight = 110;

    const startX = source.x + nodeWidth;
    const startY = source.y + nodeHeight / 2;

    const endX = target.x;
    const endY = target.y + nodeHeight / 2;

    const dx = Math.max(40, Math.abs(endX - startX) * 0.5);

    return `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;
  }

  getTempWirePath(): string {
    const src = this.connectingSourceNode();
    const mouse = this.connectingMousePos();
    if (!src || !mouse) return '';

    const nodeWidth = 250;
    const nodeHeight = 110;

    const startX = src.x + nodeWidth;
    const startY = src.y + nodeHeight / 2;
    const endX = mouse.x;
    const endY = mouse.y;

    const dx = Math.max(40, Math.abs(endX - startX) * 0.5);
    return `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;
  }

  getEdgeMidpoint(edge: FlowEdge): { x: number; y: number } {
    const flow = this.automationService.activeFlow();
    if (!flow) return { x: 0, y: 0 };
    const source = flow.nodes.find(n => n.id === edge.source);
    const target = flow.nodes.find(n => n.id === edge.target);
    if (!source || !target) return { x: 0, y: 0 };
    const nodeWidth = 250;
    const nodeHeight = 110;
    const startX = source.x + nodeWidth;
    const startY = source.y + nodeHeight / 2;
    const endX = target.x;
    const endY = target.y + nodeHeight / 2;
    return {
      x: (startX + endX) / 2,
      y: (startY + endY) / 2
    };
  }

  // Node Connections in Inspector
  getNodeIncomingEdges(nodeId: string): FlowEdge[] {
    const flow = this.automationService.activeFlow();
    if (!flow) return [];
    return flow.edges.filter(e => e.target === nodeId);
  }

  getNodeOutgoingEdges(nodeId: string): FlowEdge[] {
    const flow = this.automationService.activeFlow();
    if (!flow) return [];
    return flow.edges.filter(e => e.source === nodeId);
  }

  getNodeById(nodeId: string): FlowNode | undefined {
    return this.automationService.activeFlow()?.nodes.find(n => n.id === nodeId);
  }

  getAvailableTargetNodes(sourceNodeId: string): FlowNode[] {
    const flow = this.automationService.activeFlow();
    if (!flow) return [];
    const connectedTargets = new Set(flow.edges.filter(e => e.source === sourceNodeId).map(e => e.target));
    return flow.nodes.filter(n => n.id !== sourceNodeId && !connectedTargets.has(n.id));
  }

  connectFromInspector(targetNodeId: string) {
    const src = this.selectedNode();
    if (!src || !targetNodeId) return;
    this.connectNodes(src.id, targetNodeId);
    this.targetSelectForNode = '';
    const targetNode = this.getNodeById(targetNodeId);
    this.showToast(`Linked: ${src.title} → ${targetNode?.title || 'Target'}`);
  }

  saveCurrentFlow() {
    const flow = this.automationService.activeFlow();
    if (!flow) return;

    this.automationService.updateAutomation(flow.id, {
      name: flow.name,
      description: flow.description,
      trigger_type: flow.trigger_type,
      is_active: flow.is_active,
      nodes: flow.nodes,
      edges: flow.edges
    }).subscribe({
      next: () => {
        // Silent or toast feedback
      },
      error: (err) => console.error('Error saving flow:', err)
    });
  }

  // Execution & Testing
  runTestFlow(commit: boolean = true) {
    const flow = this.automationService.activeFlow();
    if (!flow) return;

    // Trigger visual pulse along wires
    this.isWireAnimating.set(true);
    setTimeout(() => this.isWireAnimating.set(false), 2200);

    this.automationService.executeAutomation(flow.id, { commit }).subscribe({
      next: (res) => {
        this.showTestModal.set(true);
        this.loadRecentLogs();
        this.showToast(res.result.passed ? '⚡ Flow executed successfully!' : '⚠️ Flow completed (conditions not met)');
      },
      error: (err) => {
        console.error('Error executing flow:', err);
        alert('Failed to execute automation flow.');
      }
    });
  }

  showToast(message: string) {
    this.saveSuccessToast.set(message);
    setTimeout(() => {
      this.saveSuccessToast.set(null);
    }, 3200);
  }
}
