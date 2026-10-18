<?php
/* Development only: sample prices (the clinic sets the real ones) and the
   dev staff account linked to Dr. Rayan Halimeh's practitioner record. */
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Rayhab\Auth;
use Rayhab\Config;
use Rayhab\Db;

$cfg = Config::fromEnvironment();
$db = Db::connect($cfg->get('DATABASE_URL'));
$db->query('update rayhab.services set price_amount = case when duration_min >= 60 then 8000 else 6000 end where price_amount is null');
foreach (array_filter(explode(',', $cfg->get('DEV_STAFF'))) as $u) {
    [$email, , $pid] = array_pad(explode(':', $u), 3, '');
    $db->query('update rayhab.practitioners set auth_user_id = ?::uuid where id = ?', [Auth::devUserId($email), $pid]);
}
