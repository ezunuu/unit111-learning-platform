export type QuestionApprovalRole = 'admin' | 'training_manager' | 'team_leader' | 'employee';

export type QuestionApprovalActor = {
  id: string;
  role: QuestionApprovalRole;
};

export type QuestionApprovalTarget = {
  status: string;
  createdBy: string;
};

export function canApproveQuestion(
  actor: QuestionApprovalActor,
  question: QuestionApprovalTarget,
): boolean {
  return actor.role === 'admin' && question.status === 'pending_review';
}
