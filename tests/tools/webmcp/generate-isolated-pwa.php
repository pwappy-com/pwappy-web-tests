<?php
/** Calls the installed, unmodified output generator, not WordPress/publication.
 * Fixture SW policy is explicitly supplied as editor script/event inputs.
 * No .env, database, container, account, publication, or credentials are loaded.
 */
$root = realpath($argv[1] ?? '');
$plugin = realpath($argv[2] ?? '');
$revision = $argv[3] ?? '';
if (!$root || !preg_match('#^/tmp/pwappy-generated-pwa-[^/]+$#', $root)
    || !$plugin || !in_array($revision, ['one', 'two'], true)) throw new RuntimeException('Unsafe fixture arguments');
require $plugin . '/vendor/autoload.php';
define('EXEC_ENV', 'UNITTEST');
$_ENV = ['OUTPUT_DIR' => $root . '/output/', 'APP_BASE' => 'isolated-pwappy-generator'];
$assets = $root . '/input/assets';
if (!is_dir($assets)) mkdir($assets, 0755, true);
file_put_contents($assets . '/offline.html', '<!doctype html><title>Offline fixture</title><p id="offline">Precached offline page</p>');
$functions = [
 'fixtureInstall' => "function fixtureInstall(event) { event.waitUntil(caches.open('fixture-$revision').then(cache => cache.addAll(['./', './offline.html', './main.js?$revision', './ads/ads.js?$revision', './manifest.webmanifest'])).then(() => self.skipWaiting())); }",
 'fixtureActivate' => "function fixtureActivate(event) { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== 'fixture-$revision').map(key => caches.delete(key)))).then(() => self.clients.claim())); }",
 'fixtureFetch' => "function fixtureFetch(event) { if (event.request.method === 'GET' && new URL(event.request.url).origin === self.location.origin) event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request))); }",
 'fixtureMessage' => "function fixtureMessage(event) { event.ports[0]?.postMessage('$revision'); }",
];
$scripts = ['scripts' => []]; $events = [];
foreach (['install', 'activate', 'fetch', 'message'] as $event) {
 $name = 'fixture' . ucfirst($event);
 $scripts['scripts'][] = ['scriptName' => $name, 'scriptType' => 'function', 'scriptValue' => [$functions[$name]]];
 $events[] = ['eventName' => $event, 'properties' => ['listenerTarget' => 'self', 'scripts' => [$name]]];
}
$templates = [['tagName' => 'app', 'domId' => 'fixture-app', 'attributes' => [], 'children' => [
 ['tagName' => 'p', 'domId' => 'revision', 'attributes' => [], 'text' => $revision],
]]];
$settings = ['app_header' => '<link rel="manifest" href="manifest.webmanifest">', 'lang' => 'en', 'app_exp' => 'Isolated generated PWA', 'body_top' => '', 'body_bottom' => '', 'web_app_manifest' => json_encode(['name' => 'Isolated generated Pwappy', 'short_name' => 'Fixture', 'display' => 'standalone', 'start_url' => './'])];
$reflection = new ReflectionClass(\Pwappy\Infrastructure\ApplicationService\UserProjectService::class);
$service = $reflection->newInstanceWithoutConstructor();
$method = $reflection->getMethod('createOutputWebFiles');
$method->setAccessible(true);
$method->invoke($service, 'fixture', 'offline', 'v1', 'Generated fixture', $revision, $root . '/input', $settings, ['templates' => $templates], [], $scripts, $events, $templates);
echo json_encode(['generator' => $reflection->getFileName(), 'sha256' => hash_file('sha256', $reflection->getFileName()), 'revision' => $revision, 'output' => $root . '/output/fixture/offline/v1']);
