import { Injectable } from '@nestjs/common';
import { JwtService as NestJwtService } from '@nestjs/jwt';

export interface JwtPayload {
  sub: string;
  phone: string;
  role: string;
}

@Injectable()
export class JwtWrapperService {
  constructor(private readonly jwtService: NestJwtService) {}

  generateToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload);
  }

  verifyToken(token: string): JwtPayload {
    return this.jwtService.verify<JwtPayload>(token);
  }
}
