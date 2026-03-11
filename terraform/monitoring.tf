# SOC 2 CC7.1 / CC7.2 — EC2 CPU utilization monitoring

resource "aws_cloudwatch_metric_alarm" "ec2_cpu_high" {
  alarm_name          = "clawgent-ec2-cpu-high"
  alarm_description   = "EC2 CPU utilization exceeds ${var.cpu_alarm_threshold}% for ${var.cpu_alarm_evaluation_periods} consecutive periods"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = var.cpu_alarm_evaluation_periods
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = var.cpu_alarm_period_seconds
  statistic           = "Average"
  threshold           = var.cpu_alarm_threshold
  treat_missing_data  = "breaching"

  dimensions = {
    InstanceId = var.ec2_instance_id
  }

  actions_enabled = var.alarm_sns_topic_arn != ""
  alarm_actions   = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
  ok_actions      = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}
