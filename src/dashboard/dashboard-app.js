import express from 'express';

import { JOB_STATE_VALUES } from '../constants/job.constants.js';
import { ConfigService } from '../services/config.service.js';
import { listDeadJobs, retryDeadJob } from '../services/dlq.service.js';
import { listJobs } from '../services/job.service.js';
import { MetricsService } from '../services/metrics.service.js';
import { StatusService } from '../services/status.service.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="3">
    <title>${escapeHtml(title)} | QueueCTL</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  </head>
  <body class="bg-light">
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
      <div class="container-fluid">
        <a class="navbar-brand" href="/">QueueCTL</a>
        <div class="navbar-nav">
          <a class="nav-link" href="/">Dashboard</a>
          <a class="nav-link" href="/jobs">Jobs</a>
          <a class="nav-link" href="/dlq">Dead Letter Queue</a>
          <a class="nav-link" href="/metrics">Metrics</a>
          <a class="nav-link" href="/config">Config</a>
        </div>
      </div>
    </nav>
    <main class="container py-4">${body}</main>
  </body>
</html>`;
}

function card(label, value) {
  return `<div class="col"><div class="card shadow-sm"><div class="card-body">
    <div class="text-muted small">${escapeHtml(label)}</div>
    <div class="fs-3 fw-semibold">${escapeHtml(value)}</div>
  </div></div></div>`;
}

function renderJobsTable(jobs, includeRetry = false) {
  const rows = jobs
    .map(
      (job) => `<tr>
        <td class="text-nowrap">${escapeHtml(job.jobId)}</td>
        <td>${escapeHtml(job.state)}</td>
        <td>${escapeHtml(job.priority)}</td>
        <td>${escapeHtml(job.attempts)}</td>
        <td>${escapeHtml(job.executionDuration ?? '-')}</td>
        <td>${escapeHtml(job.command)}</td>
        <td>${escapeHtml(job.createdAt?.toISOString?.() || job.createdAt || '-')}</td>
        ${
          includeRetry
            ? `<td><form method="post" action="/dlq/${escapeHtml(
                job.jobId
              )}/retry"><button class="btn btn-sm btn-primary">Retry</button></form></td>`
            : ''
        }
      </tr>`
    )
    .join('');

  return `<div class="table-responsive"><table class="table table-sm table-striped align-middle">
    <thead><tr>
      <th>Job ID</th><th>State</th><th>Priority</th><th>Attempts</th><th>Duration</th><th>Command</th><th>Created</th>${
        includeRetry ? '<th>Action</th>' : ''
      }
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="${includeRetry ? 8 : 7}" class="text-muted">No jobs found.</td></tr>`}</tbody>
  </table></div>`;
}

export function createDashboardApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.get('/', async (req, res, next) => {
    try {
      const status = await new StatusService().getStatus();
      const processingJobs = await listJobs({ state: 'processing' }, { limit: 10 });
      res.send(
        layout(
          'Dashboard',
          `<h1 class="mb-4">Dashboard</h1>
          <div class="row row-cols-2 row-cols-md-3 g-3 mb-4">
            ${card('Pending', status.jobs.pending)}
            ${card('Processing', status.jobs.processing)}
            ${card('Completed', status.jobs.completed)}
            ${card('Failed', status.jobs.failed)}
            ${card('Dead', status.jobs.dead)}
            ${card('Active Workers', status.activeWorkers)}
          </div>
          <h2 class="h4">Current Processing Jobs</h2>
          ${renderJobsTable(processingJobs)}`
        )
      );
    } catch (error) {
      next(error);
    }
  });

  app.get('/jobs', async (req, res, next) => {
    try {
      const filters = {};
      if (req.query.state && JOB_STATE_VALUES.includes(String(req.query.state))) {
        filters.state = String(req.query.state);
      }
      const jobs = await listJobs(filters, { limit: 100, sort: { createdAt: -1 } });
      const search = String(req.query.search || '').toLowerCase();
      const visibleJobs = search
        ? jobs.filter((job) => `${job.jobId} ${job.command}`.toLowerCase().includes(search))
        : jobs;
      res.send(
        layout(
          'Jobs',
          `<h1 class="mb-4">Jobs</h1>
          <form class="row g-2 mb-3">
            <div class="col-md-4"><input class="form-control" name="search" placeholder="Search" value="${escapeHtml(
              req.query.search || ''
            )}"></div>
            <div class="col-md-3"><select class="form-select" name="state"><option value="">All states</option>${JOB_STATE_VALUES.map(
              (state) =>
                `<option value="${state}" ${req.query.state === state ? 'selected' : ''}>${state}</option>`
            ).join('')}</select></div>
            <div class="col-md-2"><button class="btn btn-dark w-100">Filter</button></div>
          </form>
          ${renderJobsTable(visibleJobs)}`
        )
      );
    } catch (error) {
      next(error);
    }
  });

  app.get('/dlq', async (req, res, next) => {
    try {
      res.send(layout('DLQ', `<h1 class="mb-4">Dead Letter Queue</h1>${renderJobsTable(await listDeadJobs({ limit: 100 }), true)}`));
    } catch (error) {
      next(error);
    }
  });

  app.post('/dlq/:jobId/retry', async (req, res, next) => {
    try {
      await retryDeadJob(req.params.jobId);
      res.redirect('/dlq');
    } catch (error) {
      next(error);
    }
  });

  app.get('/metrics', async (req, res, next) => {
    try {
      const metrics = await new MetricsService().getMetrics();
      res.send(
        layout(
          'Metrics',
          `<h1 class="mb-4">Metrics</h1><div class="row row-cols-2 row-cols-md-3 g-3">
            ${Object.entries(metrics)
              .filter(([, value]) => !Array.isArray(value))
              .map(([key, value]) =>
                card(key, typeof value === 'number' ? value.toFixed(2) : value ?? '-')
              )
              .join('')}
          </div>`
        )
      );
    } catch (error) {
      next(error);
    }
  });

  app.get('/config', async (req, res, next) => {
    try {
      const config = await new ConfigService().getConfig();
      res.send(
        layout(
          'Config',
          `<h1 class="mb-4">Config</h1>
          <pre class="bg-white border rounded p-3">${escapeHtml(JSON.stringify(config, null, 2))}</pre>`
        )
      );
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    res.status(500).send(layout('Error', `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`));
  });

  return app;
}
