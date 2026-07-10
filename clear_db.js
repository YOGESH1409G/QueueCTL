
import mongoose from 'mongoose';
import 'dotenv/config';
import { Job } from './src/models/job.model.js';

const clear = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const result = await Job.deleteMany({});
    console.log('Deleted', result.deletedCount, 'jobs');

  } catch (error) {
    console.error('Error clearing database:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

clear();
