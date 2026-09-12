# Feature folders

Colocate each feature's components, API functions, query keys and hooks here when implementing it. Use services/api-client.ts and @gym/contracts across the REST boundary. Recharts is installed for reports; no fabricated report data is rendered.

Dashboard routes are public shells without private data, not authorization gates. Before adding protected data, implement session integration and verify authorization at the API. Never trust the URL or a selected frontend role. The login form validates input and calls the explicit 501 backend foundation endpoint; it does not store tokens or claim authentication succeeded.
