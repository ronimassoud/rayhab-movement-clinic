<?php
/* Rayhab booking API: loading.

   Plain PHP 8.3+, no Composer packages. It needs the pdo_pgsql, curl,
   openssl and mbstring extensions, all part of Ubuntu's php packages.
   Classes live under src/ in the Rayhab namespace: Rayhab\Routes\Admin is
   src/Routes/Admin.php. */
declare(strict_types=1);

spl_autoload_register(static function (string $class): void {
    if (strncmp($class, 'Rayhab\\', 7) !== 0) return;
    $file = __DIR__ . '/' . str_replace('\\', '/', substr($class, 7)) . '.php';
    if (is_file($file)) require $file;
});

date_default_timezone_set('UTC');
mb_internal_encoding('UTF-8');
