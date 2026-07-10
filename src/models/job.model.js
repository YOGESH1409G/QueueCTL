import mongoose from 'mongoose';

import {
  JOB_PRIORITIES,
  JOB_PRIORITY_RANK,
  JOB_PRIORITY_VALUES,
  JOB_STATES,
  JOB_STATE_VALUES,
} from '../constants/job.constants.js';

const { Schema, model, models } = mongoose;

const jobSchema = new Schema(
  {
    jobId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      validate: {
        validator(value) {
          return typeof value === 'string' && value.trim().length > 0;
        },
        message: 'jobId must be a non-empty string.',
      },
    },
    command: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: [1, 'command is required.'],
      maxlength: [4096, 'command cannot exceed 4096 characters.'],
    },
    state: {
      type: String,
      required: true,
      enum: {
        values: JOB_STATE_VALUES,
        message: 'state must be one of: pending, processing, completed, failed, dead, retrying.',
      },
      default: JOB_STATES.PENDING,
      index: true,
    },
    priority: {
      type: String,
      required: true,
      enum: {
        values: JOB_PRIORITY_VALUES,
        message: 'priority must be one of: HIGH, MEDIUM, LOW.',
      },
      default: JOB_PRIORITIES.MEDIUM,
      uppercase: true,
      trim: true,
    },
    priorityRank: {
      type: Number,
      required: true,
      default: JOB_PRIORITY_RANK[JOB_PRIORITIES.MEDIUM],
      min: [1, 'priorityRank must be at least 1.'],
      max: [3, 'priorityRank cannot exceed 3.'],
    },
    timeout: {
      type: Number,
      default: null,
      min: [1, 'timeout must be at least 1ms.'],
      validate: {
        validator(value) {
          return value === null || Number.isInteger(value);
        },
        message: 'timeout must be an integer in milliseconds.',
      },
    },
    runAt: {
      type: Date,
      default: null,
    },
    attempts: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'attempts cannot be negative.'],
      validate: {
        validator: Number.isInteger,
        message: 'attempts must be an integer.',
      },
    },
    maxRetries: {
      type: Number,
      required: true,
      default: 3,
      min: [0, 'maxRetries cannot be negative.'],
      validate: {
        validator: Number.isInteger,
        message: 'maxRetries must be an integer.',
      },
    },
    nextRetryAt: {
      type: Date,
      default: null,
    },
    output: {
      type: String,
      default: null,
      maxlength: [20000, 'output cannot exceed 20000 characters.'],
    },
    stdout: {
      type: String,
      default: null,
      maxlength: [20000, 'stdout cannot exceed 20000 characters.'],
    },
    stderr: {
      type: String,
      default: null,
      maxlength: [20000, 'stderr cannot exceed 20000 characters.'],
    },
    exitCode: {
      type: Number,
      default: null,
    },
    executionDuration: {
      type: Number,
      default: null,
      min: [0, 'executionDuration cannot be negative.'],
    },
    timedOut: {
      type: Boolean,
      default: false,
    },
    logFilePath: {
      type: String,
      default: null,
      trim: true,
    },
    error: {
      type: String,
      default: null,
      maxlength: [20000, 'error cannot exceed 20000 characters.'],
    },
    startedAt: {
      type: Date,
      default: null,
    },
    claimedByWorkerId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    leaseExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'jobs',
    timestamps: true,
    versionKey: false,
  }
);

jobSchema.index({ jobId: 1 }, { unique: true });
jobSchema.index({ state: 1, createdAt: -1 });
jobSchema.index({ state: 1, nextRetryAt: 1, runAt: 1, priorityRank: 1, createdAt: 1 });
jobSchema.index({ state: 1, startedAt: 1 });
jobSchema.index({ state: 1, leaseExpiresAt: 1 });
jobSchema.index({ createdAt: -1 });

jobSchema.pre('validate', function setPriorityRank() {
  if (this.priority) {
    this.priority = this.priority.toUpperCase();
    this.priorityRank = JOB_PRIORITY_RANK[this.priority];
  }
});

jobSchema.path('completedAt').validate(function validateCompletedAt(value) {
  if (!value || !this.startedAt) {
    return true;
  }

  return value >= this.startedAt;
}, 'completedAt cannot be earlier than startedAt.');

jobSchema.path('attempts').validate(function validateAttempts(value) {
  if (typeof this.maxRetries !== 'number') {
    return true;
  }

  return value <= this.maxRetries + 1;
}, 'attempts cannot exceed maxRetries plus the first attempt.');

export const Job = models.Job || model('Job', jobSchema);
