import { z } from 'zod';

export const createProjectSchema = z.object({
  body: z.object({
    projectName: z.string().optional(),
    project_name: z.string().optional(),
    projectType: z.string().optional(),
    project_type: z.string().optional(),
  }).refine((data) => !!(data.projectName || data.project_name), {
    message: 'Project name is required',
    path: ['projectName'],
  }),
});

export const updateProjectSchema = z.object({
  body: z.record(z.string(), z.any()),
});

export const createMinorSchema = z.object({
  body: z.object({
    minorName: z.string().optional(),
    minor_name: z.string().optional(),
  }).refine((data) => !!(data.minorName || data.minor_name), {
    message: 'Minor name is required',
    path: ['minorName'],
  }),
});
