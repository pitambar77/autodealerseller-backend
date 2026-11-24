import mongoose from 'mongoose';
import { config } from './config.js';

mongoose.set('strictQuery', true);

export async function connectDb(uri = config.mongoUri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  return mongoose.connection;
}

export const disconnectDb = () => mongoose.disconnect();
