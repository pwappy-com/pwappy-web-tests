import '@pwappy-web/components/AiCoderWindow.js';
import '@pwappy-web/components/AgentEntry.js';
import '@pwappy-web/components/dashboard/DashboardPoint.js';
import settings from '@pwappy-web/components/UserSettingStore.js';
import {loadLocalAiConfig, LS_AI_CONFIG_KEY} from '@pwappy-web/components/UserSettingSlice.js';

import {initializeCommandEngine} from '@pwappy-web/commands/CommandEngine.js';
import templateJsonStore from '@pwappy-web/components/TemplateJsonStore.js';
import scriptItemStore from '@pwappy-web/components/ScriptItemStore.js';
import eventItemStore from '@pwappy-web/components/EventItemStore.js';
import appSettingStore from '@pwappy-web/components/AppSettingStore.js';
import attributeItemStore from '@pwappy-web/components/AttributeItemStore.js';
import toolBoxItemStore from '@pwappy-web/components/ToolBoxItemStore.js';
import serviceworkerItemStore from '@pwappy-web/components/ServiceWorkerItemStore.js';

initializeCommandEngine({templateJsonStore, scriptItemStore, eventItemStore, appSettingStore, attributeItemStore, toolBoxItemStore, serviceworkerItemStore});

document.cookie = 'pwappy_login=1; path=/; SameSite=Strict';
settings.dispatch(loadLocalAiConfig(JSON.parse(localStorage.getItem(LS_AI_CONFIG_KEY) || '{}')));
const field = document.querySelector('#active');
function open(tag) {
  if (field.firstElementChild?.localName === tag) return;
  const pane = document.createElement(tag);
  if (tag === 'agent-chat-window') pane.appHeader = 'local-integration';
  if (tag === 'ai-coder-window') {
    pane.targetScriptName = 'fixtureScript';
    pane.targetScriptValue = 'function fixtureScript() { return 1; }';
  }
  field.replaceChildren(pane);
  pane.show?.();
  if (tag === 'dashboard-point') pane.showPwappyPoints();
}
document.querySelectorAll('nav button').forEach(button =>
  button.addEventListener('click', () => open(button.dataset.tab)));
