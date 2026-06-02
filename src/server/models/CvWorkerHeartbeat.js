const mongoose = require('mongoose');

const { WORKER_HEARTBEAT_STATUSES } = require('../../constants/cvWorkerHealth');

const cvWorkerHeartbeatSchema = new mongoose.Schema(
  {
    workerId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      maxlength: 128,
    },
    status: {
      type: String,
      enum: WORKER_HEARTBEAT_STATUSES,
      required: true,
      default: 'starting',
    },
    lastHeartbeatAt: {
      type: Date,
      required: true,
      index: true,
    },
    startedAt: {
      type: Date,
      required: true,
    },
    host: {
      type: String,
      default: '',
      maxlength: 256,
    },
    pid: {
      type: Number,
      default: null,
    },
    activeJobs: {
      type: Number,
      default: 0,
      min: 0,
    },
    metadata: {
      batchSize: { type: Number, default: null },
      concurrency: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CvWorkerHeartbeat', cvWorkerHeartbeatSchema);
module.exports.WORKER_HEARTBEAT_STATUSES = WORKER_HEARTBEAT_STATUSES;
