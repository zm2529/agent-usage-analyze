import { FileToolPanel } from './panels/FileToolPanel';
import { TerminalToolPanel } from './panels/TerminalToolPanel';
import { SearchToolPanel } from './panels/SearchToolPanel';
import { AgentToolPanel } from './panels/AgentToolPanel';
import { AskUserQuestionPanel } from './panels/AskUserQuestionPanel';
import { GenericToolPanel } from './panels/GenericToolPanel';
import type { ComponentType } from 'react';
import type { ToolCall, ToolResult } from '@/lib/types';

const TOOL_ALIASES: Record<string, string> = {
  read_file: 'Read',
  edit_file: 'Edit',
  write_to_file: 'Write',
  run_terminal_command: 'Bash',
  codebase_search: 'Grep',
  grep_search: 'Grep',
  file_search: 'Glob',
  list_dir: 'Glob',
  // Codex CLI
  shell: 'Bash',
  apply_patch: 'Edit',
  commandExecution: 'Bash',
  command_execution: 'Bash',
  fileChange: 'Edit',
  file_change: 'Edit',
  // Copilot CLI
  bash: 'Bash',
  write_file: 'Write',
  patch_file: 'Edit',
  // VS Code Copilot Chat
  copilot_readFile: 'Read',
  copilot_replaceString: 'Edit',
  copilot_insertEdit: 'Edit',
  copilot_applyPatch: 'Edit',
  copilot_createFile: 'Write',
  copilot_findTextInFiles: 'Grep',
  copilot_findFiles: 'Glob',
  copilot_listDirectory: 'Glob',
  copilot_runInTerminal: 'Bash',
  copilot_getTerminalOutput: 'Bash',
  copilot_getErrors: 'Bash',
  copilot_searchCodebase: 'Grep',
  copilot_think: 'Task',
};

const TOOL_COMPONENTS: Record<string, ComponentType<ToolPanelProps>> = {
  Read: FileToolPanel,
  Write: FileToolPanel,
  Edit: FileToolPanel,
  Bash: TerminalToolPanel,
  Glob: SearchToolPanel,
  Grep: SearchToolPanel,
  Task: AgentToolPanel,
  AskUserQuestion: AskUserQuestionPanel,
};

interface ToolPanelProps {
  toolCall: ToolCall;
  result?: ToolResult;
}

export function ToolPanel({ toolCall, result }: ToolPanelProps) {
  const canonicalName = TOOL_ALIASES[toolCall.name] ?? toolCall.name;
  const Panel = TOOL_COMPONENTS[canonicalName] ?? GenericToolPanel;
  return <Panel toolCall={toolCall} result={result} />;
}

export { FileToolPanel } from './panels/FileToolPanel';
export { TerminalToolPanel } from './panels/TerminalToolPanel';
export { SearchToolPanel } from './panels/SearchToolPanel';
export { AgentToolPanel } from './panels/AgentToolPanel';
export { AskUserQuestionPanel } from './panels/AskUserQuestionPanel';
export { GenericToolPanel } from './panels/GenericToolPanel';
