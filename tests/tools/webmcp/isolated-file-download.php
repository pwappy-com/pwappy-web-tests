<?php
/**
 * Isolated integration adapter, NOT a WordPress endpoint replacement.
 * Real: installed FileDownloadUseCase::execute(), its trait/responses, ZipArchive.
 * Adapted: request, CurrentUser/container, JWT gate, and HTTP response streaming.
 * No WordPress bootstrap, .env loading, account lookup, or production storage.
 * Router supplies $isolatedPluginDir, $isolatedRoot and synthetic $_ENV.
 */

function isolatedDownloadError(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode(['error' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') isolatedDownloadError(405, 'POST required');
$root = realpath($isolatedRoot ?? '');
$projects = realpath($_ENV['PROJECT_DIR'] ?? '');
if (!$root || !preg_match('#^/tmp/pwappy-readapi-isolated-[^/]+$#', $root)
    || $projects !== $root . '/projects'
    || ($_ENV['ASSETS_DIR_NAME'] ?? '') !== 'assets') {
    isolatedDownloadError(500, 'Synthetic fixture configuration required');
}
require_once $isolatedPluginDir . '/vendor/autoload.php';
try {
    $token = $_COOKIE[$_ENV['AUTH_COOKIE_NAME'] ?? 'pwappy_auth'] ?? '';
    $claims = \Firebase\JWT\JWT::decode($token, new \Firebase\JWT\Key($_ENV['PUBLIC_KEY'], 'RS256'));
    if (($claims->sub ?? '') !== 'webmcp1') throw new RuntimeException('Unexpected fixture identity');
} catch (Throwable $error) {
    isolatedDownloadError(401, 'Fixture authentication required');
}
$params = json_decode(file_get_contents('php://input'), true);
if (!is_array($params)
    || ($params['appKey'] ?? null) !== 'fixture'
    || ($params['version'] ?? null) !== 'v1'
    || ($params['path'] ?? null) !== ''
    || ($params['directories'] ?? null) !== []
    || ($params['files'] ?? null) !== ['test.txt']) {
    isolatedDownloadError(400, 'Only the single synthetic fixture file is permitted');
}
$asset = $projects . '/webmcp1/fixture/v1/assets/test.txt';
if (realpath($asset) !== $asset || !is_file($asset)) isolatedDownloadError(500, 'Fixture file missing or unsafe');
// The use case creates assets.zip in this synthetic user directory only.
$zipPath = $projects . '/webmcp1/assets.zip';
if (file_exists($zipPath) || is_link($zipPath)) isolatedDownloadError(409, 'Fixture ZIP already exists');

final class PwappyContainer
{
    public static array $services = [];
    public static function getContainer(): self { return new self(); }
    public function get(string $id) { return self::$services[$id] ?? throw new RuntimeException('Unexpected service: ' . $id); }
}
final class IsolatedDownloadRequest implements \Pwappy\UseCase\Interface\Web\RequestInterface
{
    public function __construct(private array $params) {}
    public function getParams(): array { return $this->params; }
    public function getParam(string $key) { return $this->params[$key] ?? null; }
    public function getHeader($key) { return null; }
    public function getBody() { return json_encode($this->params); }
    public function getAttribute(string $key) { return null; }
    public function getFileParams() { return []; }
    public function getClientIp(): string { return '127.0.0.1'; }
}
PwappyContainer::$services[\Monolog\Logger::class] = new \Monolog\Logger('isolated-download', [new \Monolog\Handler\NullHandler()]);
PwappyContainer::$services['CurrentUser'] = new class {
    public function getIdentKey() { return new class { public function getValue(): string { return 'webmcp1'; } }; }
};
try {
    $result = (new \Pwappy\UseCase\FileDownloadUseCase())->execute(new IsolatedDownloadRequest($params));
    if ($result->getCode() !== 200 || ($result->getDetails()['zipFileName'] ?? '') !== $zipPath || !is_file($zipPath)) {
        throw new RuntimeException('Production download use case failed');
    }
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="assets.zip"');
    header('Content-Length: ' . filesize($zipPath));
    readfile($zipPath);
} finally {
    // Only the new ZIP owned by this synthetic invocation may be removed.
    if (is_file($zipPath) && !is_link($zipPath)) unlink($zipPath);
}
exit;
