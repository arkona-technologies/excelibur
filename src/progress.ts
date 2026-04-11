export type ProgressReporter = (percent: number, label: string) => void;

export type StepProgressReporter = (
  done: number,
  total: number,
  label: string,
) => void;

const PROGRESS_PREFIX = "__EXCELIBUR_PROGRESS__";

export function create_progress_reporter(): ProgressReporter | null {
  if (process.env["EXCELIBUR_PROGRESS"] !== "1") {
    return null;
  }

  return (percent: number, label: string) => {
    const bounded = Math.max(0, Math.min(100, Math.round(percent)));
    console.log(`${PROGRESS_PREFIX}|${bounded}|${label}`);
  };
}

export function create_step_progress_reporter(
  reporter: ProgressReporter | null,
  start_percent: number,
  end_percent: number,
): StepProgressReporter {
  return (done: number, total: number, label: string) => {
    if (!reporter) {
      return;
    }

    const safe_total = total <= 0 ? 1 : total;
    const fraction = Math.max(0, Math.min(1, done / safe_total));
    const percent =
      start_percent + fraction * (end_percent - start_percent);

    reporter(percent, label);
  };
}
