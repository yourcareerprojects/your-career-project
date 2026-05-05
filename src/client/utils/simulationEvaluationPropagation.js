function applyUserEvaluationToResultsSnapshot(resultsSnapshot, nextEvaluation, isMatchingRole) {
  if (!resultsSnapshot || typeof resultsSnapshot !== 'object' || typeof isMatchingRole !== 'function') {
    return resultsSnapshot;
  }

  let changed = false;

  const patchRoleList = (roles) => {
    if (!Array.isArray(roles)) return roles;
    return roles.map((role) => {
      if (!isMatchingRole(role)) return role;
      changed = true;
      return { ...role, userEvaluation: nextEvaluation };
    });
  };

  const nextResults = { ...resultsSnapshot };
  nextResults.nextSteps = patchRoleList(resultsSnapshot.nextSteps);
  nextResults.outsideTheBox = patchRoleList(resultsSnapshot.outsideTheBox);

  if (resultsSnapshot.evaluationFlow) {
    const flow = resultsSnapshot.evaluationFlow;
    const nextFlow = { ...flow };
    nextFlow.nextSteps = patchRoleList(flow.nextSteps);
    nextFlow.outsideTheBox = patchRoleList(flow.outsideTheBox);

    if (flow.ranked) {
      const patchRankedRows = (rows) => {
        if (!Array.isArray(rows)) return rows;
        return rows.map((row) => {
          const rowRole = row?.step || row;
          if (!isMatchingRole(rowRole)) return row;
          changed = true;
          return {
            ...row,
            userEvaluation: nextEvaluation,
            step: row.step ? { ...row.step, userEvaluation: nextEvaluation } : row.step,
          };
        });
      };
      nextFlow.ranked = {
        ...flow.ranked,
        nextSteps: patchRankedRows(flow.ranked.nextSteps),
        outsideTheBox: patchRankedRows(flow.ranked.outsideTheBox),
      };
    }

    nextResults.evaluationFlow = nextFlow;
  }

  return changed ? nextResults : resultsSnapshot;
}

module.exports = {
  applyUserEvaluationToResultsSnapshot,
};

