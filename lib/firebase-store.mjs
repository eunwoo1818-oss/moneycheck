import { Firestore } from '@google-cloud/firestore';
import { ExternalAccountClient } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';
import { firestoreRepository } from './firestore-repository.mjs';

export function createFirestoreClient() {
  const projectId=process.env.FIREBASE_PROJECT_ID;
  if(!projectId)throw new Error('FIREBASE_PROJECT_ID 설정이 필요합니다.');
  const options={projectId,preferRest:true,ignoreUndefinedProperties:false};
  if(process.env.VERCEL){
    const number=process.env.GCP_PROJECT_NUMBER,email=process.env.GCP_SERVICE_ACCOUNT_EMAIL;
    const pool=process.env.GCP_WORKLOAD_IDENTITY_POOL_ID,provider=process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
    if(!number||!email||!pool||!provider)throw new Error('Firebase 서버 인증 설정이 필요합니다.');
    options.authClient=ExternalAccountClient.fromJSON({
      type:'external_account',
      audience:`//iam.googleapis.com/projects/${number}/locations/global/workloadIdentityPools/${pool}/providers/${provider}`,
      subject_token_type:'urn:ietf:params:oauth:token-type:jwt',
      token_url:'https://sts.googleapis.com/v1/token',
      service_account_impersonation_url:`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${email}:generateAccessToken`,
      subject_token_supplier:{getSubjectToken:()=>getVercelOidcToken()},
    });
    options.authClient.scopes=['https://www.googleapis.com/auth/datastore'];
  }
  return new Firestore(options);
}
export function openFirebaseStore(){return firestoreRepository(createFirestoreClient());}
