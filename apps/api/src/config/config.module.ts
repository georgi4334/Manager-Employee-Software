import { Global, Module } from '@nestjs/common';
import { parseEnv, type Env } from './env.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): Env => parseEnv(process.env) }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
