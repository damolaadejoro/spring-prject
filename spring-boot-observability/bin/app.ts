#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ObservabilityStack } from '../lib/observability-stack';

const app = new cdk.App();

new ObservabilityStack(app, 'SpringBootObservabilityStack', {
  /* You can add stack props here if needed, e.g., env: { region: 'us-east-1' } */
});