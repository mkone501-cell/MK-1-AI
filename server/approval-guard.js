'use strict';

function canExecuteProtectedAction({ session, approval }) {
  if (!session?.user || session.user.role !== 'owner') return false;
  if (!approval || approval.status !== '承認済み') return false;
  return approval.approvedBy === session.user.id && approval.decisionSource === 'owner-session';
}

module.exports = { canExecuteProtectedAction };

