<?php
/* The API, assembled: services, routes, and one handle() for every request.
   Apache sends /api/* to public/index.php, which builds a Request from the
   globals and sends back what handle() returns. */
declare(strict_types=1);

namespace Rayhab;

final class App
{
    public readonly Guard $guard;
    public readonly Scheduling $sched;
    public readonly Records $records;
    public readonly Notify $notify;
    public readonly Links $links;
    public readonly Payments $payments;
    public readonly Auth $auth;
    public readonly Whish $whish;

    /** @var list<array{0:string,1:string,2:callable}> */
    private array $routes = [];

    public function __construct(public readonly Config $cfg, public readonly Db $db)
    {
        $this->guard = new Guard($db, $cfg);
        $this->sched = new Scheduling($db, $cfg);
        $this->records = new Records($db);
        $this->notify = new Notify($db, $cfg);
        $this->links = new Links($db, $cfg);
        $this->payments = new Payments($db, $cfg, $this->notify);
        $this->auth = new Auth($cfg);
        $this->whish = new Whish($cfg, $db);

        $this->get('/api/health', function () { $this->db->query('select 1'); return Response::json(['ok' => true]); });
        Routes\PublicRoutes::register($this);
        Routes\PatientRoutes::register($this);
        Routes\AuthRoutes::register($this);
        Routes\AdminRoutes::register($this);
        Routes\EnquiryRoutes::register($this);
        Routes\Webhooks::register($this);
    }

    public function get(string $p, callable $h): void { $this->routes[] = ['GET', $p, $h]; }
    public function post(string $p, callable $h): void { $this->routes[] = ['POST', $p, $h]; }
    public function patch(string $p, callable $h): void { $this->routes[] = ['PATCH', $p, $h]; }

    public function handle(Request $r): Response
    {
        try {
            foreach ($this->routes as [$method, $pattern, $handler]) {
                $re = '#^' . preg_replace('#\{(\w+)\}#', '(?P<$1>[^/]+)', $pattern) . '$#';
                if (!preg_match($re, $r->path, $m)) continue;
                if ($method !== $r->method && !($method === 'GET' && $r->method === 'HEAD')) continue;
                $params = array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY);
                return $handler($r, array_map('rawurldecode', $params));
            }
            return Response::json(['error' => ['code' => 'not_found', 'message' => 'No such endpoint.']], 404);
        } catch (ApiError $e) {
            return Response::json($e->body(), $e->status);
        } catch (\Throwable $e) {
            error_log('[rayhab] ' . $r->id . ' ' . $r->method . ' ' . self::maskUrl($r->path) . ': ' . $e);
            return Response::json(['error' => ['code' => 'internal', 'message' => 'Something went wrong on our side.']], 500);
        }
    }

    /* A payment link's token is in some paths; it never reaches a log. */
    public static function maskUrl(string $url): string
    {
        $url = (string) preg_replace('#(/payment-selection/)[^/?\#]+#', '$1…', $url);
        return (string) preg_replace('/([?&](?:t|token)=)[^&#]+/', '$1…', $url);
    }
}
