import type Redis from "ioredis";

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

export type RedisClient = Redis | null;
