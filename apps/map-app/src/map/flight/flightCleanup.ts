type RestoreStep = {
  label: string;
  run: () => void;
};

/** Run each restore action on its own so one MapLibre failure cannot leave
 * pitch limits, clip overrides, or interaction handlers unrestored. */
export function runIndependentRestoreSteps(steps: RestoreStep[]) {
  steps.forEach((step) => {
    try {
      step.run();
    } catch (error) {
      console.error(`Flight mode restore failed (${step.label}).`, error);
    }
  });
}
