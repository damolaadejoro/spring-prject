import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';
import { Construct } from 'constructs';

export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'SpringBootVpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    const cluster = new ecs.Cluster(this, 'SpringBootCluster', {
      vpc,
      clusterName: 'spring-boot-cluster',
    });

    // Build and push Docker image automatically
    // Adjust the directory path based on where your Dockerfile is located
    const imageAsset = new DockerImageAsset(this, 'SpringBootImage', {
      directory: './spring-boot-app', // Assuming Dockerfile is in project root
      // If your Dockerfile is in a subdirectory, adjust like:
      // directory: path.join(__dirname, '../app'),
      // or
      // directory: path.join(__dirname, '../src'),
    });

    // IMPORTANT: Task Execution Role with ECR permissions
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'ECS Task Execution Role with ECR permissions',
    });

    // Add ECR permissions - THIS FIXES THE AccessDeniedException ERROR
    taskExecutionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
      ],
      resources: ['*'],
    }));

    // Add CloudWatch Logs permissions
    taskExecutionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: ['*'],
    }));

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'ECS Task Role for application permissions',
    });

    const logGroup = new logs.LogGroup(this, 'SpringBootLogGroup', {
      logGroupName: '/ecs/spring-boot-app',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole: taskExecutionRole,  // Use our custom role with ECR permissions
      taskRole: taskRole,
    });

    const container = taskDefinition.addContainer('SpringBootContainer', {
      // Use the automatically built and pushed Docker image
      image: ecs.ContainerImage.fromDockerImageAsset(imageAsset),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'spring-boot',
        logGroup: logGroup,
      }),
      environment: {
        SPRING_PROFILES_ACTIVE: 'prod',
        SERVER_PORT: '8080',
      },
    });

    container.addPortMappings({
      containerPort: 8080,
      protocol: ecs.Protocol.TCP,
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
    });

    const listener = alb.addListener('Listener', {
      port: 80,
      open: true,
    });

    const service = new ecs.FargateService(this, 'SpringBootService', {
      cluster,
      taskDefinition,
      desiredCount: 2,
      assignPublicIp: false,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    listener.addTargets('SpringBootTarget', {
      port: 8080,
      targets: [service],
      healthCheck: {
        path: '/actuator/health',
        interval: cdk.Duration.seconds(30),
      },
    });

    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: alb.loadBalancerDnsName,
      description: 'Load Balancer DNS',
    });

    new cdk.CfnOutput(this, 'ECRRepositoryUri', {
      value: imageAsset.repository.repositoryUri,
      description: 'ECR Repository URI',
    });

    new cdk.CfnOutput(this, 'ImageUri', {
      value: imageAsset.imageUri,
      description: 'Docker Image URI',
    });
  }
}