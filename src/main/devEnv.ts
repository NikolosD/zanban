import { app } from 'electron'
import dotenv from 'dotenv'

// Provider keys may come from a local .env while developing. A packaged build
// must not read a .env from whatever directory it was launched in.
if (!app.isPackaged) dotenv.config()
