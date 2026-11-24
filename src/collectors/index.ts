import type { SourceId } from '../core/types';
import { boards } from './boards';
import { getonboard, remoteok, remotive, weworkremotely } from './feeds';
import { glassdoor } from './glassdoor';
import { gupy } from './gupy';
import { indeed } from './indeed';
import { linkedin } from './linkedin';
import type { Collector } from './types';

export const COLLECTORS: Record<SourceId, Collector> = {
  gupy,
  linkedin,
  indeed,
  glassdoor,
  getonboard,
  remotive,
  remoteok,
  weworkremotely,
  boards,
};

export const SOURCE_IDS = Object.keys(COLLECTORS) as SourceId[];
