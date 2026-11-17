import * as playwright from '@playwright/test';

// Public test-only instrumentation. No URL, app name, page content or error
// message is serialized. Ordinary suite calls execute without an extra step.
export type EditorPhase =
  | 'editor_preconditions' | 'editor_popup' | 'editor_domcontentloaded'
  | 'editor_overlay_setup' | 'editor_snapshot' | 'editor_starter'
  | 'editor_final_assertions' | 'popup_interception' | 'popup_trigger'
  | 'popup_create' | 'popup_navigation';
export function editorPhase<T>(phase: EditorPhase, operation: () => Promise<T>): Promise<T> {
  if (process.env.PWAPPY_RUNNER_BENCHMARK !== 'true') return operation();
  return playwright.test.step('runner-editor-detail:' + phase, operation);
}
