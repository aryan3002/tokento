import path from 'path';
import dotenv from 'dotenv';

// From packages/api/src/config/ go up 4 levels to monorepo root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();
