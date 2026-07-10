
import mongoose from 'mongoose';
import 'dotenv/config';
import { Job } from './src/models/job.model.js';

const reset = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const result = await Job.updateMany(
      { state: 'processing' },
      { $set: { state: 'pending', startedAt: null } }
    );
    console.log('Reset', result.modifiedCount, 'jobs');

  } catch (error) {
    console.error('Error resetting jobs:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

reset();
