
import mongoose from 'mongoose';
import 'dotenv/config';
import { Job } from './src/models/job.model.js';

const inspect = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const jobs = await Job.find({});
    console.log('Jobs:', JSON.stringify(jobs, null, 2));

  } catch (error) {
    console.error('Error inspecting database:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};


