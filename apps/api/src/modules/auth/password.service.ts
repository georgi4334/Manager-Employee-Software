import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// OWASP Password Storage Cheat Sheet: argon2id, 19 MiB, 2 iterations, 1 lane.
// algorithm 2 = Argon2id (the package exports it as a const enum, unusable with isolatedModules).
const OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

@Injectable()
export class PasswordService {
  /** Verified when no account matches, so response time does not reveal whether an email exists. */
  private readonly dummyHash = hash('intime-timing-equalizer', OPTIONS);

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  async verifyDummy(password: string): Promise<void> {
    await this.verify(await this.dummyHash, password);
  }
}
