'use strict';
/** MCP prompts: slash-command style templates (plans/05-mcp-server.md 1.3). Prompt arguments are strings. */
const { z } = require('zod');

const user = (text) => ({ messages: [{ role: 'user', content: { type: 'text', text } }] });

module.exports = function register(server) {
  server.registerPrompt('publish_everywhere', {
    title: 'Publish everywhere',
    description: 'Upload one image or video and post it to every connected platform with captions written for each',
    argsSchema: {
      mediaUrl: z.string().describe('Public URL (or local path, if allowed) of the image or video'),
      topic: z.string().describe('What the post is about'),
    },
  }, ({ mediaUrl, topic }) => user(`Publish this to every connected platform of the project.
Media: ${mediaUrl}
Topic: ${topic}

Steps:
1. get_project: note the connected platforms and the caption footer/hashtags that are added automatically (don't repeat them).
2. Upload the media (upload_media_from_url for URLs, upload_media_from_path for local files) and use its suggestedType as contentType.
3. Write a caption per platform in the project's voice: LinkedIn professional, Instagram/Facebook short and visual, YouTube with a title and a description. Put platform-specific text in targets[].overrides.caption (and overrides.title for YouTube).
4. validate_post and fix any errors. Skipped platforms are fine.
5. Show me the captions, platforms and timing, and wait for my OK.
6. create_post, then wait_for_post and give me the live links (or the errors).`));

  server.registerPrompt('weekly_schedule', {
    title: 'Plan a week of posts',
    description: 'Plan and schedule several posts across a week on a topic',
    argsSchema: {
      topic: z.string().describe('Theme or campaign for the week'),
      startDate: z.string().describe('First day, e.g. 2026-11-24'),
    },
  }, ({ topic, startDate }) => user(`Plan a week of posts about "${topic}" starting ${startDate}.

1. get_project for connected platforms and settings, and list_posts to avoid repeating recent posts.
2. Propose a schedule: 3 to 5 posts, each with day and time (with my UTC offset), platforms, content type and caption. Ask me for any media you need (URLs or files).
3. Wait for my approval or edits.
4. For each approved post: upload media if any, validate_post, then create_post with publishNow: false and scheduledAt.
5. Summarize what is scheduled (post ids and times). I can cancel any of them in History.`));

  server.registerPrompt('linkedin_carousel', {
    title: 'LinkedIn carousel',
    description: 'Plan and post a swipeable LinkedIn PDF carousel from slide images or a finished PDF',
    argsSchema: {
      topic: z.string().describe('What the carousel is about'),
      slides: z.string().optional().describe('Slide image URLs/paths (in order) or one PDF; leave empty to get an outline first'),
    },
  }, ({ topic, slides }) => user(`Make a LinkedIn PDF carousel about "${topic}".
Slides: ${slides && slides.trim() ? slides : '(none yet: propose an outline first)'}

Steps:
1. get_project and check that LinkedIn is connected. If it isn't, stop and tell me to connect it in the app.
2. Propose a slide outline (a hook slide, 4 to 8 value slides, a call-to-action slide), a carousel title (shown above the slides) and the post caption. Wait for my OK.
3. Upload the media: each slide image with upload_media_* (in order), or the PDF if I gave one.
4. For images: build_carousel_pdf with the image ids in slide order (size 1080x1350 unless I asked otherwise). For a PDF, use its id directly.
5. validate_post with contentType "document", that one PDF media id, the title, and target linkedin. Fix any errors.
6. Show me the title, caption, page count and timing, and wait for my OK.
7. create_post, then wait_for_post and give me the live link (or the error).`));

  server.registerPrompt('fix_failed_posts', {
    title: 'Fix failed posts',
    description: 'Find failed or partial posts, explain the errors and retry what can be retried',
  }, () => user(`Check this project's recent failed and partially published posts.

1. list_posts with status "failed", then "partial".
2. get_post for each and read the per-platform errors.
3. Group them: temporary errors (timeouts, rate limits, server errors) can be retried; account problems (expired token, "reconnect") need me to reconnect the account in the app's Connections page; content problems need a new post.
4. Tell me the plan, then retry_post_target only for the ones I approve, and wait_for_post on them.
5. Report what was fixed and what I still need to do.`));
};
