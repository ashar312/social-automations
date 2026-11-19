'use strict';
const { z } = require('zod');
const { RULES, SUPPORTED } = require('../../platforms/rules');
const { projectView } = require('../../services/projects');
const format = require('../format');

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

module.exports = function register(define, ctx) {
  define('get_project', {
    title: 'Get project',
    description: 'The project this key belongs to: name, settings (caption footer and hashtags that are added to every caption automatically) '
      + 'and which platforms are connected. Call this first, and only target connected platforms.',
    annotations: READ,
    outputSchema: z.looseObject({ id: z.string(), name: z.string(), connections: z.array(z.looseObject({ platform: z.string(), connected: z.boolean() })) }),
  }, async () => {
    const p = await projectView(ctx.project);
    return { text: format.project(p), data: p };
  });

  define('get_platform_rules', {
    title: 'Get platform rules',
    description: 'Per-platform limits (caption/title length, video duration and size, image ratios, carousel sizes) and which content types each platform accepts.',
    annotations: READ,
    outputSchema: z.looseObject({ rules: z.record(z.string(), z.any()), supportedContentTypes: z.record(z.string(), z.array(z.string())) }),
  }, async () => {
    const data = { rules: RULES, supportedContentTypes: SUPPORTED };
    return { text: JSON.stringify(data, null, 2), data };
  });
};
