"""
Bias Detection -- Flags demographic disparities in query results.

When query results contain demographic dimensions (race, gender, ethnicity)
alongside outcome measures (costs, condition rates, treatment counts), this
service checks whether the variation across groups exceeds a threshold.

If it detects a >20% disparity between the highest and lowest demographic
groups, it generates an advisory warning that appears in the UI. This
directly addresses Microsoft's Fairness principle.

This is NOT a statistical test -- it's a simple disparity flag designed
to prompt human investigation. The warning says "consider consulting
domain experts" rather than making causal claims.
"""

from typing import Optional
from dataclasses import dataclass


# Column names that indicate demographic grouping
DEMOGRAPHIC_COLUMNS = {
    "race", "ethnicity", "gender", "marital",
    "age_group", "agegroup", "age_range",
}

# Column names that indicate numeric outcomes
OUTCOME_COLUMNS = {
    "count", "patient_count", "cnt", "total",
    "avg", "average", "mean", "sum",
    "cost", "total_cost", "avg_cost",
    "rate", "prevalence", "percentage",
}


@dataclass
class BiasAlert:
    has_disparity: bool
    message: str
    demographic_column: str = ""
    outcome_column: str = ""
    max_group: str = ""
    min_group: str = ""
    disparity_ratio: float = 0.0


class BiasDetector:

    DISPARITY_THRESHOLD = 0.20  # 20% difference triggers an alert

    def check_results(
        self,
        columns: list[str],
        rows: list[list],
    ) -> Optional[BiasAlert]:
        """
        Analyze query results for demographic disparities.
        Returns a BiasAlert if a significant disparity is found, None otherwise.
        """
        if not columns or not rows or len(rows) < 2:
            return None

        col_lower = [c.lower() for c in columns]

        # Find demographic column index
        demo_idx = None
        demo_col = ""
        for i, c in enumerate(col_lower):
            if c in DEMOGRAPHIC_COLUMNS:
                demo_idx = i
                demo_col = columns[i]
                break

        if demo_idx is None:
            return None

        # Find numeric outcome column index
        outcome_idx = None
        outcome_col = ""
        for i, c in enumerate(col_lower):
            if i == demo_idx:
                continue
            if c in OUTCOME_COLUMNS or any(kw in c for kw in OUTCOME_COLUMNS):
                outcome_idx = i
                outcome_col = columns[i]
                break

        if outcome_idx is None:
            # Try the last column if it looks numeric
            last_idx = len(columns) - 1
            if last_idx != demo_idx:
                try:
                    float(rows[0][last_idx])
                    outcome_idx = last_idx
                    outcome_col = columns[last_idx]
                except (ValueError, TypeError, IndexError):
                    return None

        if outcome_idx is None:
            return None

        # Extract group -> value pairs
        groups = {}
        for row in rows:
            try:
                group_name = str(row[demo_idx]) if row[demo_idx] else "Unknown"
                value = float(row[outcome_idx]) if row[outcome_idx] else None
                if value is not None and value > 0:
                    groups[group_name] = value
            except (ValueError, TypeError, IndexError):
                continue

        if len(groups) < 2:
            return None

        # Calculate disparity
        max_group = max(groups, key=groups.get)
        min_group = min(groups, key=groups.get)
        max_val = groups[max_group]
        min_val = groups[min_group]

        if max_val == 0:
            return None

        disparity = (max_val - min_val) / max_val

        if disparity >= self.DISPARITY_THRESHOLD:
            return BiasAlert(
                has_disparity=True,
                demographic_column=demo_col,
                outcome_column=outcome_col,
                max_group=max_group,
                min_group=min_group,
                disparity_ratio=round(disparity, 3),
                message=(
                    f"Demographic disparity detected: '{outcome_col}' varies by "
                    f"{disparity:.0%} across '{demo_col}' groups "
                    f"(highest: {max_group}, lowest: {min_group}). "
                    f"This may reflect underlying health disparities, data collection "
                    f"biases, or social determinants of health. Consider consulting "
                    f"domain experts before drawing conclusions."
                ),
            )

        return None
