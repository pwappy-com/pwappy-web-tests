// Reverse only exact reviewed Premium workflow edits; legacy golden hashes stay intact.
import assert from 'node:assert/strict';
export const premiumWorkflowEdits = [
  {
    "before": "description: \"通常テストの再試行回数（既定0で初回失敗を検出）\"",
    "after": "description: \"Normal/Premiumテストの再試行回数（既定0で初回失敗を検出）\""
  },
  {
    "before": "          npx playwright test tests/specs/premium --project=${{ matrix.browser }} --reporter=line --workers=1",
    "after": "          RETRIES=\"${TEST_RETRIES:-0}\"\n          if ! [[ \"$RETRIES\" =~ ^[0-5]$ ]]; then\n            echo \"retries must be between 0 and 5\"\n            exit 1\n          fi\n          npx playwright test tests/specs/premium --project=${{ matrix.browser }} --reporter=line --workers=1 --retries=\"$RETRIES\""
  },
  {
    "before": "          echo \"EXIT_CODE=$?\" >> $GITHUB_OUTPUT\n        env:\n          TEST_RUN_SUFFIX: ${{ env.OS_SHORT_NAME }}",
    "after": "          echo \"EXIT_CODE=$?\" >> $GITHUB_OUTPUT\n        env:\n          TEST_RETRIES: ${{ inputs.retries || '0' }}\n          TEST_RUN_SUFFIX: ${{ env.OS_SHORT_NAME }}"
  }
];
export function restoreApprovedPremiumRepairs(workflow) {
    workflow = restoreApprovedPremiumPointPreparation(workflow);
    for (const { before, after } of [...premiumWorkflowEdits].reverse()) {
        assert.equal(workflow.split(after).length - 1, 1, 'exact approved Premium edit must occur once');
        workflow = workflow.replace(after, before);
    }
    return workflow;
}

export const premiumPointPreparationEdits = [
  {
    "before": "      prepare_points:\n        description: \"Premiumの残高準備（通常テストはnormal_prepare_pointsを使用）\"\n        type: boolean\n        default: false\n",
    "after": "      prepare_points:\n        description: \"Premiumの残高準備（通常テストはnormal_prepare_pointsを使用）\"\n        type: boolean\n        default: true\n"
  },
  {
    "before": "      normal_prepare_points: ${{ steps.resolve-normal-points.outputs.normal_prepare_points }}\n",
    "after": "      normal_prepare_points: ${{ steps.resolve-normal-points.outputs.normal_prepare_points }}\n      premium_prepare_points: ${{ steps.resolve-premium-points.outputs.premium_prepare_points }}\n"
  },
  {
    "before": "      - name: Resolve suite trace snapshots\n",
    "after": "      - name: Resolve premium point preparation\n        id: resolve-premium-points\n        shell: bash\n        env:\n          EVENT_NAME: ${{ github.event_name }}\n          PREMIUM_PREPARE_POINTS_INPUT: ${{ github.event.inputs.prepare_points }}\n        run: |\n          prepare=true\n          if [[ \"$EVENT_NAME\" == \"workflow_dispatch\" ]]; then\n            prepare=\"${PREMIUM_PREPARE_POINTS_INPUT:-true}\"\n          fi\n          case \"$prepare\" in\n            true|false) ;;\n            *) echo \"::error::prepare_points must be true or false\"; exit 1 ;;\n          esac\n          printf 'premium_prepare_points=%s\\n' \"$prepare\" >> \"$GITHUB_OUTPUT\"\n\n      - name: Resolve suite trace snapshots\n"
  },
  {
    "before": "    env:\n      PWAPPY_TRACE_SNAPSHOTS: ${{ needs.prepare-matrix.outputs.premium_trace_snapshots }}",
    "after": "    env:\n      PWAPPY_TEST_POINTS_ENABLED: ${{ needs.prepare-matrix.outputs.premium_prepare_points }}\n      PWAPPY_TRACE_SNAPSHOTS: ${{ needs.prepare-matrix.outputs.premium_trace_snapshots }}"
  }
];
export function restoreApprovedPremiumPointPreparation(workflow) {
    for (const { before, after } of [...premiumPointPreparationEdits].reverse()) {
        assert.equal(workflow.split(after).length - 1, 1, 'exact approved Premium point edit must occur once');
        workflow = workflow.replace(after, before);
    }
    return workflow;
}
