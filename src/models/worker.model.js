import mongoose from 'mongoose';

import {
  WORKER_RUNTIME_STATES,
  WORKER_RUNTIME_STATE_VALUES,
  WORKER_STATES,
  WORKER_STATE_VALUES,
} from '../constants/worker.constants.js';

const { Schema, model, models } = mongoose;

const workerSchema = new Schema(
  {
    workerId: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },
    pid: {
      type: Number,
      required: true,
      min: [1, 'pid must be positive.'],
    },
    state: {
      type: String,
      required: true,
      enum: {
        values: WORKER_STATE_VALUES,
        message: 'state must be one of: active, stopped.',
      },
      default: WORKER_STATES.ACTIVE,
      index: true,
    },
    runtimeState: {
      type: String,
      required: true,
      enum: {
        values: WORKER_RUNTIME_STATE_VALUES,
        message: 'runtimeState must be one of: idle, busy.',
      },
      default: WORKER_RUNTIME_STATES.IDLE,
      index: true,
    },
    currentJobId: {
      type: String,
      default: null,
      trim: true,
    },
    startedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    lastHeartbeatAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    stoppedAt: {
      type: Date,
      default: null,
    },
    stopRequestedAt: {
      type: Date,
      default: null,
    },
    supervisorId: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    collection: 'workers',
    timestamps: true,
    versionKey: false,
  }
);

workerSchema.index({ workerId: 1 }, { unique: true });
workerSchema.index({ state: 1, lastHeartbeatAt: -1 });
workerSchema.index({ state: 1, runtimeState: 1, lastHeartbeatAt: -1 });

export const Worker = models.Worker || model('Worker', workerSchema);
