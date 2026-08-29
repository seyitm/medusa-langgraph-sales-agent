export class Metrics {
  private requests = 0;
  private errors = 0;
  private totalDurationMs = 0;

  observe(durationMs: number, failed: boolean): void {
    this.requests += 1;
    this.totalDurationMs += durationMs;
    if (failed) this.errors += 1;
  }

  render(): string {
    return [
      "# HELP agent_http_requests_total Total HTTP requests.",
      "# TYPE agent_http_requests_total counter",
      `agent_http_requests_total ${this.requests}`,
      "# HELP agent_http_errors_total Total HTTP responses with status >= 500.",
      "# TYPE agent_http_errors_total counter",
      `agent_http_errors_total ${this.errors}`,
      "# HELP agent_http_request_duration_ms_total Accumulated HTTP request duration.",
      "# TYPE agent_http_request_duration_ms_total counter",
      `agent_http_request_duration_ms_total ${this.totalDurationMs}`,
      "",
    ].join("\n");
  }
}
