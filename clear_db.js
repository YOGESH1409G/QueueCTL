import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from './src/database/connection.js';

async function clearDatabase() {
  try {
    await connectDatabase({ log: true });
    
    // Drop the entire database to ensure all collections (jobs, configs, etc) are wiped clean
    await mongoose.connection.db.dropDatabase();
    
    console.log('✅ Successfully deleted all data from MongoDB.');
  } catch (error) {
    console.error('❌ Failed to clear database:', error.message);
  } finally {
    await disconnectDatabase({ log: false });
  }
}

clearDatabase();
