# PostHog post-wizard report

The wizard has completed a deep integration of your Clawgent project with PostHog analytics. This integration captures both client-side user interactions and server-side deployment events, enabling you to track the complete user journey from sign-in through deployment and feature adoption.

## Integration Summary

### Client-side Setup
- **`instrumentation-client.ts`**: PostHog initialization using `defaults: '2025-11-30'` for automatic pageview/pageleave tracking
- **Reverse proxy**: Configured via `next.config.ts` rewrites to route `/ingest/*` requests through your domain, improving tracking reliability

### Server-side Setup
- **`src/lib/posthog-server.ts`**: PostHog Node.js client singleton for server-side event capture
- **API routes**: Updated to track deployment lifecycle, agent management, and channel integration events

### User Identification
- Users are identified on the client-side when authentication completes, linking their WorkOS user ID with their session
- Server-side events include the user's distinct ID for correlation

## Events Tracked

| Event Name | Description | File(s) |
|------------|-------------|---------|
| `sign_in_started` | User initiates sign-in flow | `src/app/page.tsx` |
| `sign_out_completed` | User signs out of the application | `src/app/page.tsx` |
| `persona_selected` | User selects an agent persona/template | `src/app/page.tsx` |
| `persona_detail_viewed` | User opens the template detail modal | `src/app/page.tsx` |
| `deployment_started` | User clicks deploy button (conversion event) | `src/app/page.tsx` |
| `instance_deployed` | Instance successfully deployed (server-side) | `src/app/api/deploy/route.ts` |
| `instance_deployment_failed` | Deployment failed with error (server-side) | `src/app/api/deploy/route.ts` |
| `instance_destroyed` | User destroys their instance (server-side) | `src/app/api/instances/[id]/route.ts` |
| `agent_added` | User adds a new agent to instance (server-side) | `src/app/api/instances/[id]/agents/route.ts` |
| `channel_connected` | User connects Slack/Telegram/Discord (server-side) | `src/app/api/instances/[id]/channels/route.ts` |
| `channel_disconnected` | User disconnects a channel (server-side) | `src/app/api/instances/[id]/channels/[channelType]/route.ts` |
| `dashboard_opened` | User opens their OpenClaw dashboard | `src/app/page.tsx` |
| `agent_session_opened` | User opens a specific agent's session | `src/app/page.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

### Dashboard
- **Analytics basics**: [https://us.posthog.com/project/309728/dashboard/1265834](https://us.posthog.com/project/309728/dashboard/1265834)

### Insights
- **Deployment Trends**: [https://us.posthog.com/project/309728/insights/HhFuAIer](https://us.posthog.com/project/309728/insights/HhFuAIer) - Daily deployments started vs successfully deployed
- **Deployment Conversion Funnel**: [https://us.posthog.com/project/309728/insights/MTat9FlU](https://us.posthog.com/project/309728/insights/MTat9FlU) - User journey from sign-in through deployment to dashboard usage
- **Popular Agent Templates**: [https://us.posthog.com/project/309728/insights/3UOaSJnO](https://us.posthog.com/project/309728/insights/3UOaSJnO) - Distribution of selected personas
- **Instance Lifecycle (Churn)**: [https://us.posthog.com/project/309728/insights/o09z5LQn](https://us.posthog.com/project/309728/insights/o09z5LQn) - Track instance creation vs destruction
- **Feature Adoption (Agents & Channels)**: [https://us.posthog.com/project/309728/insights/IPfhAndN](https://us.posthog.com/project/309728/insights/IPfhAndN) - Usage of advanced features

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/posthog-nextjs-app-router/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
