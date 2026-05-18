import { Injectable } from '@nestjs/common';
import {
  JwtService as NestJwtService,
  type JwtSignOptions,
} from '@nestjs/jwt';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  pubKeyRegistered: boolean;
}

@Injectable()
export class JwtWrapperService {
  constructor(private readonly jwtService: NestJwtService) { }

  generateToken(payload: JwtPayload, options?: JwtSignOptions): string {
    return this.jwtService.sign(payload, options);
  }

  verifyToken(token: string): JwtPayload {
    return this.jwtService.verify<JwtPayload>(token);
  }
}
