<?php
/* PHP's built-in server, standing in for Apache in development:
   /api/* goes to the API exactly as Apache sends it; everything else is
   served from site/ (with the site's own 404 page for anything missing). */
declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (str_starts_with($path, '/api/')) {
    require __DIR__ . '/../public/index.php';
    return true;
}
$file = $_SERVER['DOCUMENT_ROOT'] . $path;
if (is_dir($file)) $file = rtrim($file, '/') . '/index.html';
if (is_file($file)) return false;          // the built-in server sends the file itself
http_response_code(404);
readfile($_SERVER['DOCUMENT_ROOT'] . '/404.html');
return true;
