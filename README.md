# Create a project

Install Bash, curl, Git, tar, and Node.js 22 or later. Run this command in the directory where you want to create the project:

```sh
curl -fsSL https://raw.githubusercontent.com/FreyGold/go-boilerplate/refs/heads/main/scripts/create-project.sh | bash -s -- my-project
```

Replace `my-project` with your project name. Use lowercase letters, digits, and single hyphens. Start the name with a letter. The name must be at most 63 characters and must not end with a hyphen.

The command creates `./my-project`, updates the project names, and removes the temporary clone. The new project has no Git history.

The default Go module path is `github.com/freygold/my-project`. To set a different path, add `--module github.com/your-user/my-project` after `my-project` in the command. The creation scripts keep their references to this template repository.

# Run the backend with Docker

Run these commands from the repository root:

```sh
docker compose up --build -d
docker compose logs -f backend
```

The backend is available at `http://localhost:8080`. Check its connection to PostgreSQL and Redis at `http://localhost:8080/status`. The API documentation is at `http://localhost:8080/docs`.

Compose starts PostgreSQL and Redis first. The backend then runs the database migrations. Compose stores PostgreSQL data and Redis data in named volumes.

The backend loads defaults from `apps/backend/.env.sample`. If `apps/backend/.env` exists, it overrides those defaults. Add your integration keys to `apps/backend/.env`.

Compose sets the container addresses and database credentials. Set `POSTGRES_USER`, `POSTGRES_PASSWORD`, or `POSTGRES_DB` in the root `.env` file to change the database defaults. Set `BACKEND_PORT`, `POSTGRES_PORT`, or `REDIS_PORT` there to change the host ports. PostgreSQL uses its credentials only when it creates a new data volume.

Stop the stack with `docker compose down`. This keeps the data volumes.

# History
## 2026-10-21: What I Learned
- Go Struct Tags & Reflection: Metadata syntax and runtime evaluation via reflect.

- Go Modules Management: Dependency resolution, pruning behavior of go mod tidy, and side-effect imports (_).

- Config Management (Go vs. Node): Typed configuration structs, prefix stripping, and fail-fast startup vs. global process.env.

- Dependency Injection (DI): Explicit constructor injection vs. runtime context lookups (c.Get).

- Startup Pipeline Orchestration: Integrating godotenv, zerolog, koanf, and validator/v10.

- Observability Pillars: Logs, aggregated metrics, distributed tracing, and container health probes.

- Monitoring Tooling: Managed APMs (New Relic) vs. self-hosted pipelines (Prometheus & Grafana).

- Performance Analysis: Latency percentiles (p50, p95, p99) and isolating tail-latency anomalies through distributed traces.

## 10-22 to 10-25: What I Learned
### Go Middlewares
- Go Middleware Pattern: A function that takes a handler (`next`) once at setup and returns a new handler that runs a check first, then calls `next` only if it passes (same idea as Express `next()`).

- net/http vs Echo Types: `http.Handler` uses `(w, r)`, `echo.HandlerFunc` uses `c echo.Context`; `echo.WrapMiddleware` converts net/http middleware into Echo middleware.

- `http.HandlerFunc` Type Conversion: Not a function call. It labels a plain function as a type with a `ServeHTTP` method, so it satisfies the `http.Handler` interface.

- Clerk Auth Chain: failure handler → `AuthorizationFailureHandler` (returns an `AuthorizationOption`) → `WithHeaderAuthorization` (returns `func(http.Handler) http.Handler`) → `WrapMiddleware` (returns `echo.MiddlewareFunc`).

- Immediate Invocation: `echo.WrapMiddleware(...)(func(c echo.Context) error {...})` builds the guard, then immediately calls it with the success handler to get the final `echo.HandlerFunc`.

- Deferred Execution: `w`, `r`, `c` and `next` don't exist at startup. The code defines recipes with blank parameters, and the framework fills them in on every request.

- `echo.Context`: Echo's version of Express `(req, res)`, created per request. Clerk claims are read via `c.Request().Context()`, and values are shared with routes via `c.Set` / `c.Get`.

- Applying Middleware: `api.Use(auth.RequireAuth)` guards a whole route group, `auth.RequireAuth(handler)` guards one route, and public routes (login, health) stay outside the group.

### Queues, Jobs, and all about context.Context

- Jobs and Queues: Producer creates a task, Redis stores it, Asynq consumes it, ServeMux selects the handler, and the handler performs the work.

- Current Queue State: The welcome task, payload, route, and handler exist. The producer and Enqueue call do not exist yet.

- Go Context: context.Context controls one operation through cancellation, deadlines, and small operation metadata.

- Context Creation: context.Background() creates an empty root. context.WithTimeout() creates a timed child context.

- Context Cleanup: defer cancel() stops an unused timer and releases resources when work finishes before the timeout.

- Parent and Child Contexts: Parent cancellation moves down to children. Child cancellation does not move up to the parent.

- HTTP Request Context: The Go HTTP server creates and owns the request context. It cancels the context when the client disconnects.

- Echo Context: echo.Context is Echo’s handler object. c.Request().Context() returns the standard Go context.Context.

- Context Propagation: Lower functions must receive and pass ctx. Cancellation cannot reach a function that does not receive the context.

- Asynq Context: The task factory stores a timeout setting. Asynq creates the live context when the worker starts the task.

- Task Independence: An Asynq task context is separate from the original HTTP request context. The task can continue after the HTTP request ends.

- Current Email Limitation: The welcome handler receives ctx, but the email client does not. The Asynq cancellation signal does not reach Resend.

- Production Cancellation: Timeouts limit maximum duration. Cancellation stops work early when the result is no longer needed.

- Context in Other Languages: Go uses context.Context. Node.js uses AbortController, AbortSignal, request events, and AsyncLocalStorage.

- Project Patterns: The project uses manual dependency injection, constructor functions, middleware, task routing, functional options, lifecycle methods, and some global state.
