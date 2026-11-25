# CM & SA Reports Portal

public/index.html   admin portal (summary, submissions, entry, roster)
public/submit.html  leader submission page (personal link per leader)
netlify/functions/api.mjs  serverless API storing roster + submissions (Netlify Blobs)

## Deploy
1. Put this whole folder in a GitHub repo and connect it to Netlify (New site > Import from Git).
   Publish directory: public. Functions directory: netlify/functions (already in netlify.toml).
2. Netlify > Site configuration > Environment variables: add ADMIN_KEY = a long private password.
3. Deploy, then open your site > Submissions tab > enter the ADMIN_KEY > Connect.
4. Roster tab > Upload roster (.xlsx) > Save roster. Access codes and links appear.
5. Submissions tab > "Open <week> for leaders". Share links with leaders.
