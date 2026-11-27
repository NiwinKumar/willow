import { Link } from 'react-router-dom'

import { useOrg } from '../../org'
import { ROLE_LABEL } from '../../proofApi'
import { useRetailState } from '../../state'

/**
 * AutoCampaign starts campaigns, so the api asks for an analyst or admin membership (403 `not_a_member`). Said
 * plainly, with the way in: "Choose how to explore" (the demo gate, `?choose=1`) joins an organisation with a
 * role that can act.
 */
export function NotMemberNote({ compact = false }: { compact?: boolean }) {
  const { carry } = useRetailState()
  const { org, role, instance } = useOrg()
  const to = `/retail${carry}${carry ? '&' : '?'}choose=1`
  return (
    <div role="alert" className={`flex flex-col gap-1.5 rounded-card border border-line bg-pf-amber-soft/50 ${compact ? 'px-3 py-2.5' : 'p-4'}`}>
      <span className="text-proof-small font-medium text-ink">AutoCampaign needs an analyst or admin</span>
      <span className="text-proof-small text-ink-2">
        Rules and approvals start campaigns, so they need a role that can act for an organisation.
        {org && role ? ` You are ${ROLE_LABEL[role].toLowerCase()} at ${org.name}.` : ' You haven’t joined an organisation yet.'}
      </span>
      {instance?.demo ? (
        <Link to={to} className="self-start text-proof-small font-medium text-ink no-underline hover:underline">
          Choose how to explore →
        </Link>
      ) : (
        <span className="text-proof-small text-ink-2">Ask an admin of your organisation for the analyst role.</span>
      )}
    </div>
  )
}
